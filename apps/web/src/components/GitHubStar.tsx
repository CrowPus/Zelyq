import { useQuery } from "@tanstack/react-query";
import { Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Button, IconButton } from "./ui";

/**
 * Zelyq is open source, and a star on GitHub is how other builders find it. Two places ask, and
 * neither gets in the way: a small Star button with the live count in the top bar, and a thank-you
 * card that shows once, the first time someone's own app is running. An instance can turn both off
 * (Settings → Interface).
 */

const ASKED_KEY = "zelyq:star-asked";

function useCommunity() {
  return useQuery({
    queryKey: ["community"],
    queryFn: api.community,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** 1234 → "1.2k", 12 → "12". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** GitHub's mark, drawn as GitHub publishes it. */
function GitHubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 98 96" aria-hidden focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

/** The top bar's Star button: GitHub's split style, so it reads at a glance. */
export function StarButton() {
  const community = useCommunity();
  if (!community.data?.showStar) return null;
  const { stars, url } = community.data;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={
        stars === null
          ? t("Star Zelyq on GitHub")
          : t("Star Zelyq on GitHub ({count} stars)", { count: stars })
      }
      className="group hidden h-8 shrink-0 items-center overflow-hidden rounded-md border border-border-default bg-surface text-xs font-medium text-fg-secondary shadow-sm transition-colors hover:border-border-strong hover:text-fg md:flex"
    >
      <span className="flex h-full items-center gap-1.5 px-2.5">
        <GitHubMark />
        <Star
          size={13}
          strokeWidth={2}
          className="transition-colors group-hover:fill-star group-hover:text-star"
        />
        {t("Star")}
      </span>
      {stars !== null && (
        <span className="flex h-full items-center border-l border-border-default bg-surface-subtle px-2 tabular-nums text-fg">
          {compactCount(stars)}
        </span>
      )}
    </a>
  );
}

function asked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

function remember() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Private mode: it may ask again another day; never more than once a visit.
  }
}

/**
 * The one ask: the first time this person's app is running after the agent built it. Once shown,
 * starred or not, it never comes back in this browser.
 */
export function StarMoment({ appRunning }: { appRunning: boolean }) {
  const community = useCommunity();
  const [open, setOpen] = useState(false);
  const ready = Boolean(community.data?.showStar) && appRunning;

  useEffect(() => {
    if (!ready || asked()) return;
    // A beat after the app appears, so the first thing seen is their own work.
    const timer = window.setTimeout(() => {
      remember();
      setOpen(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!open || !community.data) return null;
  const { stars, url } = community.data;
  return (
    <aside
      aria-label={t("Star Zelyq on GitHub")}
      className="star-moment fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-surface p-4 shadow-lg"
    >
      <div aria-hidden className="star-moment-sky">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Star key={i} size={10 + (i % 3) * 3} className={`star-moment-twinkle s${i}`} />
        ))}
      </div>
      <IconButton
        size="sm"
        label={t("Close")}
        tooltip={false}
        onClick={() => setOpen(false)}
        className="absolute top-2 right-2"
      >
        <X size={14} />
      </IconButton>
      <div className="relative">
        <div className="mb-2 grid size-9 place-items-center rounded-lg bg-star/15 text-star">
          <Star size={18} className="fill-current" />
        </div>
        <h2 className="text-sm font-semibold text-fg">{t("Your app is running.")}</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          {t(
            "Zelyq is open source and free to host yourself. If it helped, a star on GitHub helps other builders find it.",
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-strong px-3 text-xs font-medium text-strong-fg transition-colors hover:bg-strong-hover"
          >
            <GitHubMark size={13} />
            {t("Star Zelyq")}
            {stars !== null && (
              <span className="ml-1 rounded bg-strong-fg/15 px-1.5 tabular-nums">
                {compactCount(stars)}
              </span>
            )}
          </a>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("Maybe later")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
