/**
 * A single error type crosses every process boundary, so the browser can react
 * to `code` instead of pattern-matching on English.
 */
export type ZelyqErrorCode =
  | "bad_request"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "runtime_unavailable"
  | "model_error"
  | "aborted"
  | "internal";

const STATUS_BY_CODE: Record<ZelyqErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  aborted: 499,
  runtime_unavailable: 503,
  model_error: 502,
  internal: 500,
};

export class ZelyqError extends Error {
  readonly code: ZelyqErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ZelyqErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ZelyqError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static notFound(what: string, id?: string): ZelyqError {
    return new ZelyqError("not_found", id ? `${what} ${id} not found` : `${what} not found`);
  }

  static badRequest(message: string, details?: Record<string, unknown>): ZelyqError {
    return new ZelyqError("bad_request", message, details);
  }

  toJSON(): {
    error: { code: ZelyqErrorCode; message: string; details?: Record<string, unknown> };
  } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isZelyqError(value: unknown): value is ZelyqError {
  return value instanceof ZelyqError;
}

/** Narrow an unknown thrown value into something loggable without losing the stack. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
