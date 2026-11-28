import { guardedRequest } from "../net-guard.js";

/**
 * Tells GitHub or GitLab how a run for a commit went — the ✓ / ✗ next to a
 * commit and on a pull request. Opt-in with `source.report-status`, using the
 * source's own token. A failure to report is logged in the run, never fails it.
 */

export type ReportState = "pending" | "success" | "failure" | "cancelled";

export interface StatusTarget {
  repo: string;
  sha: string;
  token: string;
  /** The status's name, shown on GitHub/GitLab. */
  context: string;
  description: string;
  url: string | null;
  /** A fresh token at report time, for a token that runs out (the team's GitHub App). */
  refresh?: () => Promise<string | null>;
}

/** Where to send it: github.com, GitHub Enterprise (/api/v3), GitLab (/api/v4). */
export function statusEndpoint(
  repo: string,
  sha: string,
): { kind: "github" | "gitlab"; url: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(repo);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!path.includes("/")) return null;
  if (parsed.host.toLowerCase().includes("gitlab")) {
    return {
      kind: "gitlab",
      url: `${parsed.protocol}//${parsed.host}/api/v4/projects/${encodeURIComponent(path)}/statuses/${sha}`,
    };
  }
  const api =
    parsed.host.toLowerCase() === "github.com"
      ? "https://api.github.com"
      : `${parsed.protocol}//${parsed.host}/api/v3`;
  return { kind: "github", url: `${api}/repos/${path}/statuses/${sha}` };
}

/**
 * Set by the strict sandbox: the address comes from a team's repository URL,
 * so it may not be this server, a private network or a metadata address.
 */
export const statusGuard: { strict: boolean } = { strict: false };

/**
 * One POST. On a strict (cloud) server through the address guard; anywhere
 * else exactly as before, because a self-hoster's GitLab may well live on the
 * same machine or office network.
 */
async function post(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number }> {
  if (!statusGuard.strict) {
    return fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  }
  return guardedRequest(url, {
    level: "strict",
    method: "POST",
    headers: { "user-agent": "Zelyq", ...headers },
    body,
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
  });
}

export async function reportStatus(target: StatusTarget, state: ReportState): Promise<void> {
  const endpoint = statusEndpoint(target.repo, target.sha);
  if (!endpoint) throw new Error(`Cannot tell where to report for ${target.repo}.`);
  const description = target.description.slice(0, 140);
  const response =
    endpoint.kind === "github"
      ? await post(
          endpoint.url,
          {
            authorization: `Bearer ${target.token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
          },
          JSON.stringify({
            state: state === "cancelled" ? "error" : state,
            context: target.context,
            description,
            ...(target.url ? { target_url: target.url } : {}),
          }),
        )
      : await post(
          endpoint.url,
          { "private-token": target.token, "content-type": "application/json" },
          JSON.stringify({
            state: {
              pending: "running",
              success: "success",
              failure: "failed",
              cancelled: "canceled",
            }[state],
            name: target.context,
            description,
            ...(target.url ? { target_url: target.url } : {}),
          }),
        );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${endpoint.kind === "github" ? "GitHub" : "GitLab"} answered ${response.status}.`,
    );
  }
}
