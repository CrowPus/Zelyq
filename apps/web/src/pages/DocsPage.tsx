import { GUIDE_PDF_URL } from "@zelyq/core";
import { BookOpen, Download, ExternalLink } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { buttonClass } from "../components/ui";

/** Through the server, so the browser saves it rather than opening it (see routes/guide.ts). */
const DOWNLOAD_URL = "/api/guide/download";

/**
 * Docs used to be a link out to the repository's Markdown on GitHub — written
 * for contributors, one file per topic, and a different site. The beginner's
 * guide covers everything a person using Zelyq needs, so Docs opens it here,
 * to read in place or download; the technical docs stay one link away.
 */
export function DocsPage() {
  return (
    <AppShell
      crumbs={[{ label: "Docs" }]}
      actions={
        <a href={DOWNLOAD_URL} className={buttonClass("primary", "sm")}>
          <Download size={13} strokeWidth={1.75} />
          <span className="max-md:hidden">Download PDF</span>
        </a>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-default bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <BookOpen size={15} strokeWidth={1.75} className="shrink-0" />
              Zelyq: A Beginner's Guide
            </h1>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Everything from your first app to putting it online, step by step.
            </p>
          </div>
          {/* On a phone the same two choices are the page itself, below. */}
          <div className="flex items-center gap-2 max-md:hidden">
            <a
              href={GUIDE_PDF_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("secondary", "sm")}
            >
              <ExternalLink size={12} strokeWidth={1.75} />
              Open in a new tab
            </a>
            <a
              href="https://github.com/CrowPus/Zelyq/tree/main/docs"
              target="_blank"
              rel="noreferrer"
              className={buttonClass("ghost", "sm")}
            >
              Technical docs
            </a>
          </div>
        </header>

        {/* The browser's own PDF viewer: pages, search, zoom and print come with it. */}
        <iframe
          title="Zelyq: A Beginner's Guide"
          src={GUIDE_PDF_URL}
          className="hidden min-h-0 w-full flex-1 border-0 bg-canvas md:block"
        />

        {/* Phones show a PDF inside a page badly, or not at all: give it the whole screen instead. */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center md:hidden">
          <BookOpen size={28} strokeWidth={1.5} className="text-fg-muted" />
          <p className="max-w-xs text-sm text-fg-secondary">
            The guide reads best on its own screen. Open it, or keep a copy on your phone.
          </p>
          <div className="flex gap-2">
            <a
              href={GUIDE_PDF_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("primary")}
            >
              Read the guide
            </a>
            <a href={DOWNLOAD_URL} className={buttonClass("secondary")}>
              Download
            </a>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
