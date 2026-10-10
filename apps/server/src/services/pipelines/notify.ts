import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { RunStatus } from "@zelyq/core";

/**
 * Tells a chat or an incident tool how a run ended. The body works for Slack
 * and Mattermost (`text`) and Discord (`content`) as it is; anything else gets
 * the same fields as plain JSON.
 *
 * The address comes from the team's Vault, but it is still checked: a webhook
 * pointing at this server itself, or at the cloud metadata service, is refused.
 */

const BLOCKED = new BlockList();
BLOCKED.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED.addAddress("::1", "ipv6");
BLOCKED.addAddress("::", "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");

const WORDS: Record<RunStatus, string> = {
  queued: "is queued",
  running: "is running",
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
  const url = new URL(address);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("A notification address must be http:// or https://.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  for (const entry of addresses) {
    if (BLOCKED.check(entry.address, entry.family === 6 ? "ipv6" : "ipv4")) {
      throw new Error(
        `Notifications to ${host} are not allowed (it is this machine or a link-local address).`,
      );
    }
  }
  const text = `${notice.pipeline} #${notice.run} ${WORDS[notice.status]}${notice.link ? ` — ${notice.link}` : ""}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text, ...notice }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`The notification address answered ${response.status}.`);
}
