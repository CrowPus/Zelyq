/**
 * Web Crypto rather than `node:crypto`: this module is imported by the browser
 * as well as the server, and a `node:` specifier cannot be bundled.
 * `globalThis.crypto` is standard in Node 19+ and every current browser.
 *
 * Browsers only expose `crypto.randomUUID` in a secure context (HTTPS or
 * localhost). A fresh self-hosted server opened at `http://<ip>:<port>` is not
 * one, so fall back to `getRandomValues`, which is available everywhere, and
 * build the same RFC 4122 version 4 UUID from it.
 */
export function randomUUID(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Identifiers are prefixed so a value is self-describing in logs, URLs, and
 * error messages: `prj_1f0a…` is unmistakably a project.
 */
export const ID_PREFIXES = {
  user: "usr",
  team: "tem",
  project: "prj",
  session: "ses",
  message: "msg",
  event: "evt",
  snapshot: "snp",
  tool: "tol",
  audit: "adt",
  attachment: "atc",
  imageGeneration: "img",
  videoGeneration: "vid",
  videoReference: "vrf",
  providerConnection: "pcn",
  providerResource: "prs",
  providerOperation: "pop",
  vaultEntry: "ven",
  vaultEntryVersion: "vev",
  projectVariable: "pvr",
  projectVariableVersion: "pvv",
  vaultServiceKey: "vsk",
  pipeline: "pip",
  pipelineRun: "run",
  pipelineVersion: "pvn",
  pipelineStep: "pst",
  pipelineArtifact: "par",
  pipelineTrigger: "ptr",
  pipelineApproval: "pap",
  pipelinePlugin: "ppl",
  deployEnvironment: "env",
  deployment: "dep",
  deployApp: "dap",
  runner: "rnr",
  teamSshKey: "tsk",
  agent: "agt",
  agentProposal: "apr",
  agentReference: "arf",
  agentOauthGrant: "aog",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomUUID().replaceAll("-", "")}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${ID_PREFIXES[kind]}_`);
}

/**
 * Slug used for on-disk directories and preview hostnames. Never derived from
 * user input alone — always paired with an id to stay unique.
 */
export function slugify(input: string, fallback = "project"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}
