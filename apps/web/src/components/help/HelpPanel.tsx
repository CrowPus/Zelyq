import { GUIDE_PDF_URL } from "@zelyq/core";
import { ArrowLeft, BookOpen, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ARTICLE_IDS,
  type ArticleId,
  type Articles,
  articleFor,
  loadArticles,
} from "../../help/articles";
import { currentLanguage, t } from "../../lib/i18n";
import { globalPaths } from "../../lib/routes";
import { matches } from "../ListControls";
import { Markdown } from "../Markdown";
import { Drawer, Pressable, SearchField, Spinner } from "../ui";

/* The panel is opened from anywhere (the help menu, a link in a page), so its
 * state lives outside React, like the command palette's. */
type State = { open: boolean; article: ArticleId | null };
let state: State = { open: false, article: null };
const listeners = new Set<() => void>();
function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}
/** Opens help on an article, or on the one for the page being viewed. */
export function openHelp(article: ArticleId | null = null) {
  set({ open: true, article });
}
function useHelpState(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/** Plain text of an article, to search and to show a line of. */
function plain(markdown: string): string {
  return markdown
    .replace(/[*`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Help beside the page: the article for where you are opens first, every
 * other article is a search away, and the page stays usable while you read.
 * Only the reader's language is loaded, and only once help is opened.
 */
export function HelpPanel() {
  const { open, article } = useHelpState();
  const { pathname } = useLocation();
  const here = articleFor(pathname);
  const [articles, setArticles] = useState<Articles | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<ArticleId | null>(null);
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || articles) return;
    loadArticles(currentLanguage())
      .then(setArticles)
      .catch(() => setFailed(true));
  }, [open, articles]);

  // Each opening starts on the asked-for article, or this page's. Moving to
  // another page while it is open leaves the article being read alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an opening picks the article
  useEffect(() => {
    if (!open) return;
    setViewing(article ?? here);
    setQuery("");
  }, [open, article]);

  // A new article starts at its top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the article changes
  useEffect(() => {
    body.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
  }, [viewing]);

  const results = useMemo(() => {
    if (!articles) return [];
    const ordered: ArticleId[] = [here, ...ARTICLE_IDS.filter((id) => id !== here)];
    return ordered.filter((id) => matches(query, articles[id].title, plain(articles[id].body)));
  }, [articles, query, here]);

  const showList = query.trim() !== "" || viewing === null;

  return (
    <Drawer
      modal={false}
      open={open}
      onOpenChange={(next) => set({ open: next, article: null })}
      title={t("Help")}
      description={t("Read beside your work. Search finds any article.")}
    >
      <div ref={body} className="flex flex-col gap-4 px-5 py-4">
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={t("Search help")}
          aria-label={t("Search help")}
        />

        {!articles && !failed && (
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner /> {t("Loading help…")}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-xs text-danger">
            {t("Help could not be loaded. Check your connection and open it again.")}
          </p>
        )}

        {articles && showList && (
          <nav aria-label={t("Help articles")}>
            {results.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                {t("No article mentions that. Try fewer words, or the full guide below.")}
              </p>
            ) : (
              <ul className="grid gap-1">
                {results.map((id) => (
                  <li key={id}>
                    <Pressable
                      onClick={() => {
                        setViewing(id);
                        setQuery("");
                      }}
                      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-hover"
                    >
                      <FileText size={14} className="mt-0.5 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-fg">
                          {articles[id].title}
                          {id === here && (
                            <span className="rounded-sm bg-accent-subtle px-1.5 text-2xs font-normal text-accent">
                              {t("This page")}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">
                          {plain(articles[id].body)}
                        </span>
                      </span>
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-fg-muted" />
                    </Pressable>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}

        {articles && !showList && viewing && (
          <article aria-labelledby="help-article-title">
            <Pressable
              onClick={() => setViewing(null)}
              className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-sm px-1 text-xs text-fg-secondary hover:text-fg"
            >
              <ArrowLeft size={12} /> {t("All articles")}
            </Pressable>
            <h3 id="help-article-title" className="text-base font-semibold text-fg">
              {articles[viewing].title}
            </h3>
            <div className="mt-2 text-sm">
              <Markdown>{articles[viewing].body}</Markdown>
            </div>
          </article>
        )}

        <div className="mt-2 grid gap-1 border-t border-border-default pt-3 text-sm">
          <Link
            to={globalPaths.docs}
            onClick={() => set({ open: false, article: null })}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg"
          >
            <BookOpen size={14} /> {t("The beginner’s guide, start to finish")}
          </Link>
          <a
            href={GUIDE_PDF_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg"
          >
            <ExternalLink size={14} /> {t("Open the guide as a PDF")}
          </a>
          <a
            href="https://github.com/CrowPus/Zelyq/tree/main/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg"
          >
            <ExternalLink size={14} /> {t("Technical docs, for developers")}
          </a>
        </div>
      </div>
    </Drawer>
  );
}
