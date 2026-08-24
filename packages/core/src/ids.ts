/**
 * Web Crypto rather than `node:crypto`: this module is imported by the browser
 * as well as the server, and a `node:` specifier cannot be bundled.
 * `globalThis.crypto` is standard in Node 19+ and every current browser.
 */
function randomUUID(): string {
  return globalThis.crypto.randomUUID();
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
