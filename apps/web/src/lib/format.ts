/**
 * Dates, times, numbers and sizes in the viewer's own locale and time zone.
 * Nothing in the interface formats one of these by hand.
 */

const locale = (): string | undefined =>
  typeof navigator === "undefined" ? undefined : navigator.language;

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "17 Nov 2026, 22:11 GMT+1" — exact, unambiguous in every locale. */
export function formatDateTime(value: string | number | Date): string {
  // `dateStyle` cannot be combined with `timeZoneName`; spell the parts out.
  return new Intl.DateTimeFormat(locale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(toDate(value));
}

/** "17 Nov 2026" */
export function formatDate(value: string | number | Date): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(toDate(value));
}

/** "22:11" or "10:11 PM", as the viewer's locale writes it. */
export function formatTime(value: string | number | Date, seconds = false): string {
  return new Intl.DateTimeFormat(locale(), {
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
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
  if (abs < 45) return seconds <= 0 ? "just now" : "in a moment";
  if (abs > 7 * 24 * 3600) return formatDate(date);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), "minute");
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale(), options).format(value);
}

/** "1.2 MB", "0 B", "640 KB". Binary units, labelled the way people read them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
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
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
