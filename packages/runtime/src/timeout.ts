/** The longest any one command or request may be given: a day. */
export const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * A timeout that came from a caller, kept between zero and a day. A huge or
 * malformed value would otherwise hold a timer, and what it guards, for as
 * long as the caller chose.
 */
export function boundedTimeout(ms: number | undefined, fallback = 30_000): number {
  const value = Number.isFinite(ms) ? (ms as number) : fallback;
  return Math.min(Math.max(value, 0), MAX_TIMEOUT_MS);
}
