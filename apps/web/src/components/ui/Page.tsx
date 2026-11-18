import { AlertOctagon, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { t } from "../../lib/i18n";
import { Button } from "./Button.js";

const WIDTHS = {
  narrow: "max-w-[720px]",
  standard: "max-w-[1200px]",
  full: "max-w-none",
} as const;

/**
 * The one page body: a scroll container with the standard padding and one of
 * three widths. Every page sits in one, so content never jumps sideways
 * between pages.
 */
export function PageBody({
  width = "standard",
  children,
  className = "",
}: {
  width?: keyof typeof WIDTHS;
  children: ReactNode;
  className?: string;
}) {
  // Narrow pages share the standard frame and its left edge, so the title
  // never jumps sideways when moving between pages; only the content is
  // kept to a readable measure.
  const frame = width === "full" ? WIDTHS.full : WIDTHS.standard;
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto w-full px-4 pt-6 pb-16 sm:px-6 lg:pt-8 ${frame}`}>
        <div className={`${width === "narrow" ? WIDTHS.narrow : ""} ${className}`}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The one page header: title, one line of description, actions on the right,
 * and tabs underneath when the page has them.
 */
export function PageHeader({
  title,
  description,
  actions,
  tabs,
  icon,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  icon?: ReactNode;
  /** Small status line under the title: a badge, an owner, an updated time. */
  meta?: ReactNode;
}) {
  return (
    <header className={tabs ? "mb-0" : "mb-6"}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {/* At least 18rem for the title and its description: on a phone the
            actions go below them instead of squeezing them into a column. */}
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          {icon && (
            <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg border border-border-default bg-surface text-fg-secondary">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg">{title}</h1>
            {description && (
              <p className="mt-1 max-w-3xl text-base text-fg-secondary">{description}</p>
            )}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-5 mb-6">{tabs}</div>}
    </header>
  );
}

/** A titled group of content within a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Shown at the foot of the viewport when a form has unsaved changes: Save and
 * Discard, so nothing is lost and nothing is saved by accident.
 */
export function SaveBar({
  visible,
  onSave,
  onDiscard,
  saving,
  message = "You have unsaved changes",
}: {
  visible: boolean;
  onSave(): void;
  onDiscard(): void;
  saving?: boolean;
  message?: string;
}) {
  if (!visible) return null;
  return (
    <section
      aria-label={t("Unsaved changes")}
      className="sticky bottom-4 z-10 mt-6 flex items-center gap-3 rounded-lg border border-border-default bg-overlay px-4 py-2.5 shadow-overlay"
    >
      <p className="min-w-0 flex-1 text-sm text-fg">{message}</p>
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>
        {t("Discard")}
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} loading={saving}>
        {t("Save changes")}
      </Button>
    </section>
  );
}

/** Sets the browser tab title: "Page · App · Team — Zelyq". */
export function useDocumentTitle(...parts: Array<string | null | undefined | false>) {
  const title = parts.filter(Boolean).join(" · ");
  useEffect(() => {
    document.title = title ? `${title} — Zelyq` : t("Zelyq");
  }, [title]);
}

/** What a page shows when it failed to load: what happened and a way back. */
export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  action,
}: {
  title?: string;
  error?: unknown;
  onRetry?(): void;
  action?: ReactNode;
}) {
  const message: ReactNode =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "$$typeof" in error
          ? (error as unknown as ReactNode)
          : null;
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 py-14 text-center"
    >
      <div className="mb-2 grid size-11 place-items-center rounded-lg border border-danger/25 bg-danger-subtle text-danger">
        <AlertOctagon size={20} strokeWidth={1.75} />
      </div>
      <p className="text-base font-semibold text-fg">{title}</p>
      {message && <div className="max-w-md text-sm text-fg-secondary">{message}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button icon={<RotateCcw size={14} />} onClick={onRetry}>
            {t("Try again")}
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}
