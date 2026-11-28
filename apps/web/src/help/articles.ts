/**
 * The help articles the Docs panel shows: which page each belongs to, and in
 * what order they are listed. Their words are in en.ts and one file per
 * other language (fr, de, es, pt, zh, hi, it, ja), one file per language and only the reader's is loaded. A
 * test keeps every language to the same articles.
 */

export const ARTICLE_IDS = [
  "start",
  "apps",
  "build",
  "app-settings",
  "pipelines",
  "runs",
  "deployments",
  "vault",
  "members",
  "agents",
  "ops",
  "studio",
  "team-settings",
  "account",
  "admin",
] as const;

export type ArticleId = (typeof ARTICLE_IDS)[number];

export interface Article {
  title: string;
  /** Markdown. */
  body: string;
}

export type Articles = Record<ArticleId, Article>;

/**
 * Which article belongs to a page, from its address. Team pages are
 * `/<team>/<section>/…`; account, server admin and docs are not a team's.
 */
export function articleFor(pathname: string): ArticleId {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "account") return "account";
  if (parts[0] === "admin" || parts[0] === "settings") return "admin";
  if (parts[0] === "docs" || parts[0] === "dev") return "start";
  const [, section, id, sub] = parts;
  switch (section) {
    case undefined:
      return "start";
    case "apps":
      if (!id) return "apps";
      return sub === "overview" || sub === "settings" ? "app-settings" : "build";
    case "pipelines":
      return sub === "runs" ? "runs" : "pipelines";
    case "deployments":
      return "deployments";
    case "vault":
      return "vault";
    case "members":
      return "members";
    case "agents":
      return "agents";
    case "ops":
      return "ops";
    case "studio":
      return "studio";
    case "settings":
      return "team-settings";
    default:
      return "start";
  }
}

const loaders: Record<string, () => Promise<{ articles: Articles }>> = {
  en: () => import("./en"),
  fr: () => import("./fr"),
  de: () => import("./de"),
  es: () => import("./es"),
  pt: () => import("./pt"),
  zh: () => import("./zh"),
  hi: () => import("./hi"),
  it: () => import("./it"),
  ja: () => import("./ja"),
};

/** The articles in a language, English for any other. */
export async function loadArticles(language: string): Promise<Articles> {
  const load = loaders[language] ?? loaders.en!;
  return (await load()).articles;
}
