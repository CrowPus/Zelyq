import { currentLanguage, languageOf, t } from "./i18n";

/**
 * Dates, times, numbers and sizes in the viewer's own locale and time zone.
 * Nothing in the interface formats one of these by hand.
 */

/** The person's own choices (Account → Preferences); unset means the browser's. */
let preferred: { locale: string | null; timeZone: string | null } = {
  locale: null,
  timeZone: null,
};

export function setFormatPreferences(next: { locale?: string | null; timeZone?: string | null }) {
  // The page's own lang attribute is the interface language (lib/i18n), not this.
  preferred = { locale: next.locale ?? null, timeZone: next.timeZone ?? null };
}

/**
 * The account's choice; else the browser's, as long as it is in the language
 * on screen ("de-AT" for a German page); else that language itself.
 */
const locale = (): string | undefined => {
  if (preferred.locale) return preferred.locale;
  const browser = typeof navigator === "undefined" ? undefined : navigator.language;
  const shown = currentLanguage();
  if (shown === "pseudo" || languageOf(browser) === shown) return browser;
  return shown;
};
const zone = (): { timeZone?: string } =>
  preferred.timeZone ? { timeZone: preferred.timeZone } : {};

/*
 * Making an Intl formatter costs far more than using one (a page of numbers
 * was spending most of its time here), so each is made once per locale and
 * set of options.
 */
const formatters = new Map<string, unknown>();
function memo<T>(
  kind: string,
  locales: string | undefined,
  options: object | undefined,
  make: () => T,
): T {
  const key = `${kind}|${locales ?? ""}|${JSON.stringify(options ?? {})}`;
  let formatter = formatters.get(key) as T | undefined;
  if (!formatter) {
    formatter = make();
    formatters.set(key, formatter);
  }
  return formatter;
}
const numberFormat = (locales: string | undefined, options?: Intl.NumberFormatOptions) =>
  memo("number", locales, options, () => new Intl.NumberFormat(locales, options));
const dateFormat = (locales: string | undefined, options?: Intl.DateTimeFormatOptions) =>
  memo("date", locales, options, () => new Intl.DateTimeFormat(locales, options));
const relativeFormat = (locales: string | undefined, options?: Intl.RelativeTimeFormatOptions) =>
  memo("relative", locales, options, () => new Intl.RelativeTimeFormat(locales, options));

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "17 Nov 2026, 22:11 GMT+1" — exact, unambiguous in every locale. */
export function formatDateTime(value: string | number | Date): string {
  // `dateStyle` cannot be combined with `timeZoneName`; spell the parts out.
  return dateFormat(locale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...zone(),
  }).format(toDate(value));
}

/** "17 Nov 2026" */
export function formatDate(value: string | number | Date): string {
  return dateFormat(locale(), { dateStyle: "medium", ...zone() }).format(toDate(value));
}

/** "22:11" or "10:11 PM", as the viewer's locale writes it. */
export function formatTime(value: string | number | Date, seconds = false): string {
  return dateFormat(locale(), {
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    ...zone(),
  }).format(toDate(value));
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "3 hours ago", "in 5 minutes", "just now". Within a week it is relative;
 * older than that it is the date, which is what people actually want.
 */
export function formatRelative(value: string | number | Date, now = Date.now()): string {
  const date = toDate(value);
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? t("just now") : t("in a moment");
  if (abs > 7 * 24 * 3600) return formatDate(date);
  const rtf = relativeFormat(locale(), { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), "minute");
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale(), options).format(value);
}

/** "1.2 MB", "0 B", "640 KB". Binary units, labelled the way people read them. */
export function formatBytes(bytes: number): string {
  const units = [t("B"), t("KB"), t("MB"), t("GB"), t("TB")];
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${units[0]}`;
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${formatNumber(value, { maximumFractionDigits: value < 10 && exponent > 0 ? 1 : 0 })} ${units[exponent]}`;
}

/** "1 min 12 s", "450 ms", "2 h 3 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? t("{m} min {s} s", { m, s: s % 60 }) : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? t("{h} h {m} min", { h, m: m % 60 }) : `${h} h`;
}

/**
 * Any other date shape, still in the person's language and time zone. An
 * explicit `timeZone` in the options wins (a calendar day stored as UTC).
 */
export function formatDateParts(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormat(locale(), { ...zone(), ...options }).format(toDate(value));
}
