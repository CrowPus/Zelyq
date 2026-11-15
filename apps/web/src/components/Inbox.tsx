import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Bell, ServerCog } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { AgentRequests } from "./agents/AgentRequests";

/**
 * One place for everything that waits on a person: what agents asked to do
 * (pipelines, deploys, pushes, video, Ops's actions) and Ops's plans. A bell
 * on every page, with the count; open it to approve or decline where you are.
 */
export function Inbox() {
  const { team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;
  const canApprovePlans = team ? roleAtLeast(team.role, "editor") : false;
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const requests = useQuery({
    queryKey: ["agent-requests", teamId],
    queryFn: () => api.agents.requests(teamId),
    enabled: Boolean(teamId),
    refetchInterval: 15_000,
  });
  const jobs = useQuery({
    queryKey: ["ops-jobs-waiting", teamId],
    queryFn: () => api.ops.jobs(teamId),
    enabled: Boolean(teamId) && canApprovePlans,
    refetchInterval: 15_000,
    retry: false,
  });

  const agentWaiting = (requests.data?.requests ?? []).filter((r) => r.status === "pending");
  const plans = (jobs.data?.jobs ?? []).filter((job) => job.stage === "approve");
  // Counted only what this person can decide: a bell nobody can answer is noise.
  const count = (isAdmin ? agentWaiting.length : 0) + (canApprovePlans ? plans.length : 0);

  // Moving to another page closes it; so do Escape and a click outside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every change of page
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!teamId) return null;
  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        aria-label={count > 0 ? `Waiting for you: ${count}` : "Nothing waiting for you"}
        aria-expanded={open}
        title="Waiting for you"
        onClick={() => setOpen((now) => !now)}
        className="relative grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-none font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Waiting for you"
          className="fixed top-12 right-2 left-2 z-50 max-h-[75vh] overflow-y-auto rounded-lg border border-border-default bg-surface p-3 shadow-lg sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-1 sm:w-[480px]"
        >
          <p className="text-sm font-medium text-fg">Waiting for you</p>
          <p className="mb-3 text-2xs text-fg-muted">
            Everything in {team?.name} that needs a person's yes, in one place.
          </p>

          {canApprovePlans && plans.length > 0 && (
            <section className="mb-4">
              <h2 className="text-sm font-medium text-fg">Ops plans ({plans.length})</h2>
              <ul className="mt-2 grid gap-2">
                {plans.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border-default bg-surface px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <ServerCog
                        size={15}
                        strokeWidth={1.75}
                        className="mt-0.5 shrink-0 text-fg-muted"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm text-fg">{job.request}</span>
                        <span className="block text-2xs text-fg-muted">
                          A plan from Ops · {new Date(job.createdAt).toLocaleString()}
                        </span>
                      </span>
                    </span>
                    <Link
                      to={`/ops?job=${encodeURIComponent(job.id)}`}
                      className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg hover:opacity-90"
                    >
                      Read and approve
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AgentRequests teamId={teamId} canDecide={isAdmin} waitingOnly title="From agents" />

          {agentWaiting.length === 0 && plans.length === 0 && (
            <p className="py-6 text-center text-xs text-fg-muted">Nothing waits for you.</p>
          )}
        </div>
      )}
    </div>
  );
}
