import { accountServiceLinks } from "@zelyq/core";
import { CircleAlert, ExternalLink, PauseCircle, Play } from "lucide-react";
import { useState } from "react";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Button } from "./ui";

/**
 * Says so when the team you are working in is not active, and what to do:
 * a paused team is resumed by its owner here; a read-only one gets a bigger
 * plan; a suspended one is told who to contact.
 */
export function TeamStatusBanner() {
  const { team } = useActiveTeam();
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!team?.status || team.status === "active") return null;

  const accounts = session?.accounts ?? null;
  const canResume = team.role === "owner" || team.role === "admin";
  const tone =
    team.status === "suspended"
      ? "border-danger/25 bg-danger-subtle text-danger"
      : "border-warning/25 bg-warning-subtle text-fg";

  async function resume() {
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      await api.resumeTeam(team.id);
      refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs ${tone}`}
    >
      {team.status === "paused" ? (
        <PauseCircle size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
      ) : (
        <CircleAlert size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="font-medium">{team.name}: </span>
        {team.statusMessage ?? defaultMessage(team.status)}
      </span>
      {team.status === "paused" &&
        (canResume ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={12} />}
            disabled={busy}
            onClick={resume}
          >
            {busy ? t("Resuming…") : t("Resume")}
          </Button>
        ) : (
          <span className="text-fg-secondary">{t("Ask the team’s owner to resume it.")}</span>
        ))}
      {team.status === "read_only" && accounts && team.role === "owner" && (
        <a
          href={accountServiceLinks(accounts).billing(team.id)}
          className="inline-flex items-center gap-1 text-info underline-offset-2 hover:underline"
        >
          {t("Change plan")}
          <ExternalLink size={11} aria-hidden />
        </a>
      )}
      {team.status === "suspended" && accounts && (
        <a
          href={accountServiceLinks(accounts).account()}
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          {t("Contact {name}", { name: accounts.name })}
          <ExternalLink size={11} aria-hidden />
        </a>
      )}
      {error && <span className="w-full text-danger">{error}</span>}
    </div>
  );
}

function defaultMessage(status: "paused" | "read_only" | "suspended"): string {
  return status === "paused"
    ? t("This team is paused because it was not used for a while. Its apps and files are kept.")
    : status === "read_only"
      ? t("This team is read-only: nothing new can be made or run.")
      : t("This team is suspended.");
}
