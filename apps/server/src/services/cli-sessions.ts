import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Reads a locally-installed CLI's own already-consented OAuth session, so
 * Zelyq can use a subscription someone already pays for instead of asking
 * for a separate metered API key. This is never a login Zelyq
 * performs itself: the file only exists here because the person already
 * signed into that vendor's own official CLI, of their own accord, under
 * that vendor's own terms.
 *
 * Detection and the actual read both run here, server-side, on the machine
 * this process runs on — the same trust boundary plugin loading draws
 * (filesystem access to this machine is the real boundary, not a UI gate).
 * Nothing here runs on its own: every call is triggered by an explicit
 * action from an instance admin in Settings, never a background scan or a
 * timer. Narrow, explicit, one-shot reads are the only version of this
 * worth building.
 */

/** Overridable so tests can point this at a fixture instead of a real
 * `$HOME` — never something a running instance has reason to change. */
export const DEFAULT_CLAUDE_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json",
);

export interface ClaudeCodeSession {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  subscriptionType?: string;
}

/** Existence only — never reads or parses the file's content. Safe to call
 * as often as the Settings screen needs to. */
export async function detectClaudeCodeSession(
  credentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
): Promise<boolean> {
  try {
    await stat(credentialsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The actual read — only ever called from the explicit "use this" action,
 * never from detection. Returns `null` for anything short of a complete,
 * present access token: missing file, malformed JSON, a shape that doesn't
 * match what Claude Code itself writes. The caller turns `null` into a
 * plain, honest error rather than this function guessing at a partial read.
 */
export async function readClaudeCodeSession(
  credentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
): Promise<ClaudeCodeSession | null> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const oauth = (parsed as { claudeAiOauth?: Record<string, unknown> } | null)?.claudeAiOauth;
  const accessToken = oauth?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) return null;

  return {
    accessToken,
    expiresAt: typeof oauth?.expiresAt === "number" ? oauth.expiresAt : 0,
    subscriptionType:
      typeof oauth?.subscriptionType === "string" ? oauth.subscriptionType : undefined,
  };
}

/** Overridable so tests can point this at a fixture. */
export const DEFAULT_CODEX_CREDENTIALS_PATH = path.join(os.homedir(), ".codex", "auth.json");

export interface CodexSession {
  accessToken: string;
  accountId: string;
}

/** Existence only — same posture as `detectClaudeCodeSession`. */
export async function detectCodexSession(
  credentialsPath: string = DEFAULT_CODEX_CREDENTIALS_PATH,
): Promise<boolean> {
  try {
    await stat(credentialsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The actual read. Codex CLI's `auth.json` also supports plain API-key
 * mode (`auth_mode` other than the ChatGPT-session one, or `tokens` simply
 * absent) — that case returns `null` here too, same as a missing file,
 * since there is no session token to use in place of a key either way.
 */
export async function readCodexSession(
  credentialsPath: string = DEFAULT_CODEX_CREDENTIALS_PATH,
): Promise<CodexSession | null> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const tokens = (parsed as { tokens?: Record<string, unknown> } | null)?.tokens;
  const accessToken = tokens?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;

  // Codex CLI's own file usually stores this directly, but an independent
  // implementation of this same flow may not have that convenience — it
  // doesn't have Codex CLI's file, only the token — and reads the account
  // id straight
  // out of the access token's own JWT claims instead. That's the more
  // robust source, not a fallback of last resort: reading it here too
  // means a Codex CLI version that ever stops writing the plain field
  // doesn't quietly break this.
  const accountId =
    (typeof tokens?.account_id === "string" && tokens.account_id) || accountIdFromJwt(accessToken);
  if (!accountId) return null;

  return { accessToken, accountId };
}

/**
 * The `chatgpt-account-id` header value, read from the access token's own
 * (unverified — the backend itself is what actually authenticates this,
 * the same trust boundary any bearer token already has) JWT payload. Two
 * claim shapes are checked because real implementations of this same read
 * check both: `"https://api.openai.com/auth".chatgpt_account_id` first,
 * falling back to the first entry of `organizations`.
 */
function accountIdFromJwt(token: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = payload["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && "chatgpt_account_id" in auth) {
      const id = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof id === "string" && id) return id;
    }
    const organizations = payload.organizations;
    if (Array.isArray(organizations) && organizations[0]?.id) {
      const id = organizations[0].id;
      if (typeof id === "string" && id) return id;
    }
    return null;
  } catch {
    return null;
  }
}
