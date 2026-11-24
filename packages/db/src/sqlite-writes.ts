import { AsyncLocalStorage } from "node:async_hooks";
import type { Client } from "@libsql/client";

/**
 * One write at a time on a SQLite file, and a clean start after "database is
 * locked".
 *
 * libsql runs every statement synchronously. A write that meets a transaction
 * open on another of the client's connections therefore waits for the lock
 * with the event loop stopped: the transaction cannot go on to commit, the
 * whole server stands still for the busy timeout, and the write fails. So
 * writes and transactions take turns here, and a turn is only waited for
 * asynchronously. Reads take no turn: in WAL mode nothing blocks them.
 *
 * Another process on the file can still hold the lock past the busy timeout.
 * libsql leaves the statement that failed unfinished, and that connection then
 * never commits again: later writes on it answer as if saved and are lost. So
 * after SQLITE_BUSY every connection is replaced before the next write.
 */
export function takeTurns(client: Client): void {
  const execute = client.execute.bind(client) as (...args: unknown[]) => Promise<unknown>;
  const batch = client.batch.bind(client);
  const migrate = client.migrate.bind(client);
  const executeMultiple = client.executeMultiple.bind(client);
  const transaction = client.transaction.bind(client);

  let last: Promise<unknown> = Promise.resolve();
  function turn<T>(work: () => Promise<T>): Promise<T> {
    const open = currentTransaction.getStore();
    if (open?.client === client && open.open) {
      // It would wait for a transaction that is waiting for it.
      return Promise.reject(
        new Error("A write inside a transaction must use the transaction, not the database."),
      );
    }
    const next = last.then(work);
    last = next.catch(() => undefined);
    return next;
  }

  /** Replaces the connections. Only inside a turn: then no transaction is open. */
  async function replaceConnections(): Promise<void> {
    // Reads borrow and return a connection without leaving the microtask queue, so
    // at the start of a new macrotask none is in use.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!client.closed) client.reconnect();
  }

  async function recovering<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isBusy(error)) await replaceConnections();
      throw error;
    }
  }
  const write = <T>(work: () => Promise<T>) => turn(() => recovering(work));

  client.execute = (async (...args: unknown[]) => {
    const statement = args[0] as string | { sql: string };
    const text = typeof statement === "string" ? statement : statement.sql;
    if (!/^\s*select\b/i.test(text)) return await write(() => execute(...args));
    try {
      return await execute(...args);
    } catch (error) {
      // In its turn, so never under an open transaction; nobody waits for it.
      if (isBusy(error)) void turn(replaceConnections).catch(() => undefined);
      throw error;
    }
  }) as Client["execute"];
  client.batch = (statements, mode) => write(() => batch(statements, mode));
  client.migrate = (statements) => write(() => migrate(statements));
  client.executeMultiple = (text) => write(() => executeMultiple(text));

  client.transaction = (async (mode: "write" | "read" | "deferred" = "write") => {
    let done = () => {};
    const ended = new Promise<void>((resolve) => {
      done = resolve;
    });
    return await new Promise((resolve, reject) => {
      turn(async () => {
        const opened = await recovering(() => transaction(mode));
        const commit = opened.commit.bind(opened);
        const rollback = opened.rollback.bind(opened);
        const close = opened.close.bind(opened);
        let busy = false;
        const ending = async (work: () => Promise<void>) => {
          try {
            await work();
          } catch (error) {
            busy ||= isBusy(error);
            throw error;
          } finally {
            done();
          }
        };
        opened.commit = () => ending(commit);
        opened.rollback = () => ending(rollback);
        opened.close = () => {
          try {
            close();
          } finally {
            done();
          }
        };
        resolve(opened);
        await ended;
        if (busy) await replaceConnections();
      }).catch(reject);
    });
  }) as Client["transaction"];
}

const currentTransaction = new AsyncLocalStorage<{ client: Client; open: boolean }>();

/** Runs a transaction's work so that a write that goes round it is refused rather than waited for. */
export async function insideTransaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  const state = { client, open: true };
  try {
    // Awaited inside the context: a query runs when it is awaited, not when it is made.
    return await currentTransaction.run(state, async () => await work());
  } finally {
    state.open = false;
  }
}

/** Drizzle wraps the driver's error: the code is on it or on its cause. */
function isBusy(error: unknown): boolean {
  for (let one = error as { code?: unknown; cause?: unknown } | undefined; one; ) {
    if (typeof one.code === "string" && one.code.startsWith("SQLITE_BUSY")) return true;
    one = one.cause as typeof one;
  }
  return false;
}
