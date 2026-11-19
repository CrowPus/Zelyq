import { createHmac, timingSafeEqual } from "node:crypto";
import { newId, ZelyqError } from "@zelyq/core";
import type { OutboxEventRow, Store } from "@zelyq/db";

/**
 * Events for an outside system (an account service, a company's own tools):
 * Zelyq says what happened instead of being asked all the time.
 *
 * - Written first (the outbox), then sent: nothing is lost while the receiver
 *   is down.
 * - Sent to `ZELYQ_EVENTS_URL` as JSON, signed with `ZELYQ_EVENTS_SECRET`
 *   (header `zelyq-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`),
 *   retried with growing waits for three days. Each event has an id, so a
 *   receiver handles it once.
 * - Read back with `GET /api/admin/v1/events?after=<id>` (scope `events`).
 * - Written only when someone can receive them (a URL is set, or a key with
 *   the `events` scope exists): a server nobody listens to keeps nothing.
 */
export const OUT_EVENT_TYPES = [
  "account.created",
  "team.created",
  "team.deleted",
  "team.member_added",
  "team.member_removed",
  "team.resumed",
  "team.status_changed",
  "team.limit_reached",
  "error.new",
  "error.regressed",
  "health.down",
  "health.recovered",
  "previews.attention",
  "previews.recovered",
] as const;
export type OutEventType = (typeof OUT_EVENT_TYPES)[number];

const MINUTE = 60_000;
const GIVE_UP_MS = 3 * 24 * 60 * MINUTE;
const KEEP_MS = 30 * 24 * 60 * MINUTE;
const BATCH = 50;

/** The signature a receiver checks: the same function, documented in docs/admin-api.md. */
export function signEvent(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** For receivers written in TypeScript: true when the header matches and is recent. */
export function verifyEventSignature(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.trim().split("=") as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signEvent(secret, timestamp, body), "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class EventsOut {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly pending = new Set<Promise<void>>();
  private listeners: { at: number; value: boolean } = { at: 0, value: false };

  constructor(
    private readonly store: Store,
    private readonly options: {
      target?: { url: string; secret: string };
      log?: (error: unknown, message: string) => void;
      /** For tests: the clock and the network. */
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Records an event to be sent. Never throws, never waits the caller. */
  emit(type: OutEventType, data: Record<string, unknown>): void {
    const work = (async () => {
      if (!(await this.anyoneListening())) return;
      const at = new Date(this.now()).toISOString();
      await this.store.outbox.add({
        id: newId("outboxEvent"),
        type,
        data: JSON.stringify(data),
        createdAt: at,
        status: "pending",
        attempts: 0,
        nextAttemptAt: at,
        deliveredAt: null,
        lastError: null,
      });
      if (this.options.target) void this.deliver();
    })().catch((error) => this.options.log?.(error, `could not record event ${type}`));
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  async settled(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    await this.running;
  }

  /** A URL to send to, or a key that may read them: otherwise nobody would ever see them. */
  async anyoneListening(): Promise<boolean> {
    if (this.options.target) return true;
    if (this.now() - this.listeners.at < MINUTE) return this.listeners.value;
    const keys = await this.store.adminKeys.list();
    const value = keys.some((key) => !key.revokedAt && JSON.parse(key.scopes).includes("events"));
    this.listeners = { at: this.now(), value };
    return value;
  }

  /** Forgets who may listen: a key was just made or revoked. */
  keysChanged(): void {
    this.listeners = { at: 0, value: false };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.deliver();
      void this.store.outbox
        .forgetBefore(new Date(this.now() - KEEP_MS).toISOString())
        .catch((error) => this.options.log?.(error, "could not prune old events"));
    }, 5_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends what is due; one run at a time. */
  deliver(): Promise<void> {
    if (!this.options.target) return Promise.resolve();
    if (!this.running) {
      this.running = this.deliverDue().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async deliverDue(): Promise<void> {
    const target = this.options.target!;
    const send = this.options.fetch ?? fetch;
    for (;;) {
      const due = await this.store.outbox.due(new Date(this.now()).toISOString(), BATCH);
      if (due.length === 0) return;
      for (const event of due) {
        const body = JSON.stringify(present(event));
        const timestamp = Math.floor(this.now() / 1000);
        const attempts = event.attempts + 1;
        let error: string | null = null;
        try {
          const response = await send(target.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "Zelyq-Events/1",
              "zelyq-event-id": event.id,
              "zelyq-event-type": event.type,
              "zelyq-signature": `t=${timestamp},v1=${signEvent(target.secret, timestamp, body)}`,
            },
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
          if (response.status < 200 || response.status >= 300)
            error = `answered ${response.status}`;
        } catch (caught) {
          error = (caught as Error).message.slice(0, 200);
        }
        if (!error) {
          await this.store.outbox.delivered(event.id, new Date(this.now()).toISOString(), attempts);
          continue;
        }
        // 30 s, 1 min, 2 min … up to 6 h between tries; given up after three days.
        const wait = Math.min(30_000 * 2 ** (attempts - 1), 6 * 60 * MINUTE);
        const failed = this.now() - Date.parse(event.createdAt) > GIVE_UP_MS;
        await this.store.outbox.retryLater(event.id, {
          attempts,
          nextAttemptAt: new Date(this.now() + wait).toISOString(),
          lastError: error,
          failed,
        });
      }
      if (due.length < BATCH) return;
    }
  }

  /** Every event after the one named, oldest first: for catching up after an outage. */
  async list(query: { after?: string; limit?: string; type?: string }) {
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "100", 10) || 100, 1), 1000);
    let cursor: OutboxEventRow | null = null;
    if (query.after) {
      cursor = await this.store.outbox.findById(query.after);
      if (!cursor) throw ZelyqError.badRequest("That event is not here (older than 30 days?).");
    }
    const types = query.type?.split(",").filter(Boolean);
    if (types?.some((type) => !(OUT_EVENT_TYPES as readonly string[]).includes(type))) {
      throw ZelyqError.badRequest(`Event types are: ${OUT_EVENT_TYPES.join(", ")}.`);
    }
    const rows = await this.store.outbox.after(cursor, limit, types);
    return {
      events: rows.map((row) => ({
        ...present(row),
        delivery: {
          status: row.status,
          attempts: row.attempts,
          deliveredAt: row.deliveredAt,
          lastError: row.lastError,
        },
      })),
      next: rows.length === limit ? rows.at(-1)!.id : null,
    };
  }
}

function present(row: OutboxEventRow) {
  return { id: row.id, type: row.type, createdAt: row.createdAt, data: JSON.parse(row.data) };
}
