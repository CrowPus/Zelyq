import { type GuardLevel, guardedRequest } from "../net-guard.js";

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
export const statusGuard: { level: GuardLevel } = { level: "normal" };

export async function reportStatus(target: StatusTarget, state: ReportState): Promise<void> {
  const endpoint = statusEndpoint(target.repo, target.sha);
  if (!endpoint) throw new Error(`Cannot tell where to report for ${target.repo}.`);
  const description = target.description.slice(0, 140);
  const response =
    endpoint.kind === "github"
      ? await guardedRequest(endpoint.url, {
          level: statusGuard.level,
          method: "POST",
          headers: {
            authorization: `Bearer ${target.token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "Zelyq",
          },
          body: JSON.stringify({
            state: state === "cancelled" ? "error" : state,
            context: target.context,
            description,
            ...(target.url ? { target_url: target.url } : {}),
          }),
          timeoutMs: 10_000,
          maxBytes: 64 * 1024,
        })
      : await guardedRequest(endpoint.url, {
          level: statusGuard.level,
          method: "POST",
          headers: { "private-token": target.token, "content-type": "application/json" },
          body: JSON.stringify({
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
          timeoutMs: 10_000,
          maxBytes: 64 * 1024,
        });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${endpoint.kind === "github" ? "GitHub" : "GitLab"} answered ${response.status}.`,
    );
  }
}
