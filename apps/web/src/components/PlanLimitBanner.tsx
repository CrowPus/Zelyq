import { accountServiceLinks, PLAN_LIMITS, type PlanLimitKey } from "@zelyq/core";
import { ArrowUpCircle, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "../hooks/useSession";
import { PLAN_LIMIT_EVENT } from "../lib/api";

/**
 * When a plan limit stops something, anywhere in the app: on a server managed
 * by an account service, the way up. The team's owner gets "Upgrade" (to the
 * service's upgrade page for that team and limit); anyone else is told who can.
 * On a self-hosted server the error itself already says to ask an admin.
 */
export function PlanLimitBanner() {
  const { session, teams } = useSession();
  const [hit, setHit] = useState<{ teamId: string; limit: string } | null>(null);

  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ teamId?: string; limit?: string }>).detail;
      if (detail?.teamId && detail.limit) setHit({ teamId: detail.teamId, limit: detail.limit });
    };
    window.addEventListener(PLAN_LIMIT_EVENT, listen);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, listen);
  }, []);

  const accounts = session?.accounts ?? null;
  if (!hit || !accounts) return null;
  const team = teams.find((entry) => entry.id === hit.teamId);
  const label =
    hit.limit in PLAN_LIMITS
      ? PLAN_LIMITS[hit.limit as PlanLimitKey].label.toLowerCase()
      : hit.limit;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-info/25 bg-info-subtle px-4 py-2 text-xs text-fg"
    >
      <ArrowUpCircle size={14} strokeWidth={1.75} className="shrink-0 text-info" aria-hidden />
      <span className="min-w-0 flex-1">
        {team ? <span className="font-medium">{team.name}: </span> : null}
        the plan's limit for {label} was reached.
        {team?.role === "owner" ? "" : " The team's owner can choose a bigger plan."}
      </span>
      {team?.role === "owner" && (
        <a
          href={accountServiceLinks(accounts).upgrade(hit.teamId, hit.limit)}
          className="inline-flex items-center gap-1 rounded-md bg-info px-2.5 py-1 font-medium text-white hover:opacity-90"
        >
          Upgrade
          <ExternalLink size={11} aria-hidden />
        </a>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="text-fg-muted hover:text-fg"
        onClick={() => setHit(null)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
