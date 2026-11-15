import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Bell, ServerCog, Workflow } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { AgentRequests } from "./agents/AgentRequests";
import { Button } from "./ui";

/**
 * One place for everything that waits on a person, wherever they are:
 * questions pipeline runs ask (an approval step, a deploy to a protected
 * environment), Ops's plans and the steps it cannot undo, and what agents
 * asked to do. A bell on every page with the count of what this person can
 * answer; open it to answer there.
 */
export function Inbox() {
  const { team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const queryClient = useQueryClient();

  const every = { enabled: Boolean(teamId), refetchInterval: 15_000, retry: false } as const;
  const requests = useQuery({
    queryKey: ["agent-requests", teamId],
    queryFn: () => api.agents.requests(teamId),
    ...every,
  });
  const runs = useQuery({
    queryKey: ["inbox-pipeline-approvals", teamId],
    queryFn: () => api.pipelines.waitingApprovals(teamId),
    ...every,
  });
  const ops = useQuery({
    queryKey: ["inbox-ops", teamId],
    queryFn: () => api.ops.waiting(teamId),
    ...every,
  });

  const answer = useMutation({
    mutationFn: (input: { runId: string; approvalId: string; decision: "approved" | "rejected" }) =>
      api.pipelines.decide(teamId, input.runId, input.approvalId, input.decision, null),
    onSettled: () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          ["inbox-pipeline-approvals", "pipeline-runs", "pipeline", "pipelines"].includes(
            String(query.queryKey[0]),
          ),
      }),
  });

  const agentWaiting = (requests.data?.requests ?? []).filter((r) => r.status === "pending");
  const runQuestions = runs.data?.approvals ?? [];
  const opsWaiting = ops.data?.waiting ?? [];
  // Counted only what this person can answer: a bell nobody can answer is noise.
  const count =
    (isAdmin ? agentWaiting.length : 0) +
    runQuestions.filter((one) => one.canDecide).length +
    opsWaiting.filter((one) => one.canDecide).length;
  const nothing = agentWaiting.length + runQuestions.length + opsWaiting.length === 0;

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

          {runQuestions.length > 0 && (
            <Group title={`Pipeline runs (${runQuestions.length})`}>
              {answer.isError && (
                <p className="text-xs text-danger">{(answer.error as Error).message}</p>
              )}
              {runQuestions.map((one) => (
                <Item
                  key={one.approvalId}
                  icon={<Workflow size={15} strokeWidth={1.75} />}
                  title={one.message}
                  detail={
                    <>
                      <Link
                        to={`/pipelines/${one.pipelineId}/runs/${one.runId}`}
                        className="underline underline-offset-2 hover:text-fg"
                      >
                        {one.pipeline} #{one.run}
                      </Link>{" "}
                      · answer by {new Date(one.deadline).toLocaleString()}
                    </>
                  }
                  actions={
                    one.canDecide ? (
                      <span className="flex shrink-0 gap-1.5">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={answer.isPending}
                          onClick={() => answer.mutate({ ...one, decision: "approved" })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={answer.isPending}
                          onClick={() => answer.mutate({ ...one, decision: "rejected" })}
                        >
                          Reject
                        </Button>
                      </span>
                    ) : (
                      <span className="max-w-40 text-right text-2xs text-fg-muted">{one.why}</span>
                    )
                  }
                />
              ))}
            </Group>
          )}

          {opsWaiting.length > 0 && (
            <Group title={`Ops (${opsWaiting.length})`}>
              {opsWaiting.map((one) => (
                <Item
                  key={`${one.jobId}:${one.kind}:${one.words}`}
                  icon={<ServerCog size={15} strokeWidth={1.75} />}
                  title={one.kind === "plan" ? one.request : one.words}
                  detail={
                    one.kind === "plan"
                      ? `${one.words}, waiting for approval`
                      : `Cannot be undone: confirm it on its own · ${one.request}`
                  }
                  actions={
                    one.canDecide ? (
                      <Link
                        to={`/ops?job=${encodeURIComponent(one.jobId)}`}
                        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg hover:bg-primary-hover"
                      >
                        {one.kind === "plan" ? "Read and approve" : "Read and confirm"}
                      </Link>
                    ) : (
                      <span className="max-w-40 text-right text-2xs text-fg-muted">{one.why}</span>
                    )
                  }
                />
              ))}
            </Group>
          )}

          <AgentRequests teamId={teamId} canDecide={isAdmin} waitingOnly title="From agents" />

          {nothing && (
            <p className="py-6 text-center text-xs text-fg-muted">Nothing waits for you.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      <ul className="mt-2 grid gap-2">{children}</ul>
    </section>
  );
}

function Item({
  icon,
  title,
  detail,
  actions,
}: {
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border-default bg-surface px-3.5 py-2.5">
      <span className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-fg-muted">{icon}</span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm text-fg">{title}</span>
          <span className="block text-2xs text-fg-muted">{detail}</span>
        </span>
      </span>
      {actions}
    </li>
  );
}
