import type { RunStatus } from "@zelyq/core";
import { guardedRequest } from "../net-guard.js";

/**
 * Tells a chat or an incident tool how a run ended. The body works for Slack
 * and Mattermost (`text`) and Discord (`content`) as it is; anything else gets
 * the same fields as plain JSON.
 *
 * The address comes from the team's Vault, but it is still checked: a webhook
 * pointing at this server itself, or at the cloud metadata service, is refused.
 */

const WORDS: Record<RunStatus, string> = {
  queued: "is queued",
  running: "is running",
  waiting: "is waiting for approval",
  passed: "passed",
  failed: "failed",
  cancelled: "was cancelled",
  timed_out: "timed out",
};

export interface RunNotice {
  pipeline: string;
  run: number;
  status: RunStatus;
  trigger: string;
  link: string | null;
}

export async function sendNotification(address: string, notice: RunNotice): Promise<void> {
  const text = `${notice.pipeline} #${notice.run} ${WORDS[notice.status]}${notice.link ? ` — ${notice.link}` : ""}`;
  let response: { status: number };
  try {
    // "normal": a person set this address up, and the team's own chat server
    // on the office network is fine; this server and metadata addresses are not.
    response = await guardedRequest(address, {
      level: "normal",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text, ...notice }),
      timeoutMs: 10_000,
    });
  } catch (error) {
    const message = (error as Error).message;
    throw new Error(
      /this server|link-local|metadata/.test(message)
        ? `Notifications to that address are not allowed (it is this machine or a link-local address).`
        : message,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The notification address answered ${response.status}.`);
  }
}
