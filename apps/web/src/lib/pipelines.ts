import type { RunStatus, StepStatus } from "@zelyq/core";
import { t } from "./i18n";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export const RUN_STATUS: Record<RunStatus | StepStatus, { label: string; tone: Tone }> = {
  queued: { label: t("Queued"), tone: "neutral" },
  pending: { label: t("Waiting"), tone: "neutral" },
  running: { label: t("Running"), tone: "info" },
  waiting: { label: t("Waiting"), tone: "warning" },
  passed: { label: t("Passed"), tone: "success" },
  failed: { label: t("Failed"), tone: "danger" },
  cancelled: { label: t("Cancelled"), tone: "warning" },
  timed_out: { label: t("Timed out"), tone: "danger" },
  skipped: { label: t("Skipped"), tone: "neutral" },
};

export const TRIGGER_WORDS: Record<string, string> = {
  manual: t("started by hand"),
  rerun: "re-run",
  push: t("a push"),
  pull_request: t("a pull request"),
  schedule: t("the schedule"),
  api: t("the API"),
  app: t("a change to the app"),
  pipeline: t("another pipeline"),
};

/** "1m 05s" — how long something took, or has been running. */
export function duration(from: string | null, to: string | null): string {
  if (!from) return "";
  const seconds = Math.max(
    0,
    Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
