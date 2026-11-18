import { Check, CircleAlert, CircleCheck, Languages } from "lucide-react";
import type { ReactNode } from "react";
import { currentLanguage, LANGUAGES, type Language, switchLanguage, t } from "../lib/i18n";
import { Mark } from "./AppShell";
import { NativeSelect } from "./ui";

const REPO = "https://github.com/CrowPus/Zelyq";

/**
 * Every signed-out screen: the form on the right, and on a wide screen a quiet
 * panel on the left that says what Zelyq is. One column on a phone.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border-default bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_50%_at_20%_10%,var(--accent-subtle),transparent_70%),radial-gradient(50%_40%_at_90%_90%,var(--accent-subtle),transparent_70%)]"
        />
        <div className="relative flex items-center gap-2.5">
          <Mark size={28} />
          <span className="text-xl font-semibold tracking-[-0.015em] text-fg">{t("Zelyq")}</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-2xl font-semibold tracking-[-0.02em] text-fg">
            {t("Describe an app. Watch it get built. Ship it.")}
          </p>
          <ul className="mt-6 flex flex-col gap-3 text-base text-fg-secondary">
            {[
              t("An agent that writes real files you can read and keep"),
              t("Pipelines, environments and secrets in the same place"),
              t("Open source, and yours to run on your own servers"),
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <Check size={16} className="mt-1 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-fg-muted">
          {t("Zelyq is open source. {link}", {
            link: (
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="hover:text-fg hover:underline"
              >
                {t("View the code")}
              </a>
            ),
          })}
        </p>
      </aside>
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[360px]">{children}</div>
        <LanguagePicker />
      </main>
    </div>
  );
}

/** The heading block of a signed-out screen. */
export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-6 flex items-center gap-2 lg:hidden">
        <Mark size={24} />
        <span className="text-lg font-semibold tracking-[-0.015em] text-fg">{t("Zelyq")}</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      {subtitle && <p className="mt-2 text-base text-fg-secondary">{subtitle}</p>}
    </div>
  );
}

/** Sign in, reset, invitation: the layout and heading together. */
export function AuthCard(props: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <AuthLayout>
      <AuthHeading title={props.title} subtitle={props.subtitle} />
      {props.children}
    </AuthLayout>
  );
}

export function AuthError(props: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger"
    >
      <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

export function AuthNotice(props: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-success/25 bg-success-subtle px-2.5 py-2 text-xs text-success"
    >
      <CircleCheck size={14} strokeWidth={1.75} className="mt-px shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

/** Signed out, the language is this device's choice; signed in, the account's. */
function LanguagePicker() {
  const now = currentLanguage();
  return (
    <label className="mt-8 inline-flex items-center gap-2 text-xs text-fg-muted">
      <Languages size={14} aria-hidden />
      <span className="sr-only">{t("Language")}</span>
      <NativeSelect
        size="sm"
        className="w-auto"
        value={now === "pseudo" ? "en" : now}
        onChange={(event) => switchLanguage(event.target.value as Language)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.id} value={language.id} lang={language.id}>
            {language.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
