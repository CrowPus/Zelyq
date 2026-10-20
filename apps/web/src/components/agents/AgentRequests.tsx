import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentProposal } from "@zelyq/core";
import { Clapperboard, FilePen, GitBranchPlus, Rocket, RotateCcw, Workflow } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { TextDiff } from "../DiffView";
import { Badge, Button } from "../ui";

const STATUS = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Done", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
} as const;

/**
 * What agents asked a person to approve. Approving carries the action out at
 * once, as the person who approved it; the result (or why it failed) stays on
 * the request, where the agent reads it too.
 */
export function AgentRequests({
  teamId,
  canDecide,
  appNames = new Map(),
  only,
  waitingOnly = false,
}: {
  teamId: string;
  canDecide: boolean;
  appNames?: Map<string, string>;
  /** Keep to some requests — those for one pipeline, or deployments — where
   * they are shown next to what they change. */
  only?: (request: AgentProposal) => boolean;
  /** Only what still needs a decision; nothing at all when nothing does. */
  waitingOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const requests = useQuery({
    queryKey: ["agent-requests", teamId],
    queryFn: () => api.agents.requests(teamId),
    refetchInterval: 15_000,
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "decline" }) =>
      api.agents.decide(teamId, input.id, input.decision),
    // An approval changes what it was about: the pipeline, its history and
    // runs, or a deployment. Every view of those refreshes.
    onSettled: () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          [
            "agent-requests",
            "pipeline",
            "pipelines",
            "pipeline-versions",
            "pipeline-runs",
            "environments",
            "deploy",
            "video-history",
            "video",
          ].includes(String(query.queryKey[0])),
      }),
  });

  const all = (requests.data?.requests ?? []).filter((request) => !only || only(request));
  const waiting = all.filter((request) => request.status === "pending");
  const history = all.filter((request) => request.status !== "pending").slice(0, 20);
  if (all.length === 0 || (waitingOnly && waiting.length === 0)) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-medium text-fg">
        {waiting.length > 0 ? `Waiting for you (${waiting.length})` : "Requests"}
      </h2>
      {waiting.length === 0 && (
        <p className="mt-1 text-xs text-fg-secondary">Nothing waiting for approval.</p>
      )}
      {decide.isError && (
        <p className="mt-2 text-xs text-danger">{(decide.error as Error).message}</p>
      )}
      {waiting.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {waiting.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              appName={request.projectId ? appNames.get(request.projectId) : undefined}
              actions={
                canDecide ? (
                  <span className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: request.id, decision: "approve" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: request.id, decision: "decline" })}
                    >
                      Decline
                    </Button>
                  </span>
                ) : (
                  <span className="text-2xs text-fg-muted">An admin decides</span>
                )
              }
            />
          ))}
        </ul>
      )}
      {!waitingOnly && history.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="text-2xs text-fg-secondary hover:text-fg"
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory ? "Hide earlier requests" : `Earlier requests (${history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 grid gap-2">
              {history.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  appName={request.projectId ? appNames.get(request.projectId) : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function RequestRow({
  request,
  appName,
  actions,
}: {
  request: AgentProposal;
  appName: string | undefined;
  actions?: React.ReactNode;
}) {
  const Icon =
    request.actionType === "media.video"
      ? Clapperboard
      : request.actionType === "git.push"
        ? GitBranchPlus
        : request.actionType === "deploy.rollback"
          ? RotateCcw
          : request.actionType === "app.action" || request.actionType === "deploy.promote"
            ? Rocket
            : request.actionType.startsWith("pipeline.") && request.actionType !== "pipeline.run"
              ? FilePen
              : Workflow;
  const status = STATUS[request.status];
  // A pipeline change carries the file before and after: shown as a diff, open
  // while it waits, so what is approved is what was seen.
  const change =
    typeof request.payload.source === "string" && typeof request.payload.baseSource === "string"
      ? { before: request.payload.baseSource, after: request.payload.source }
      : null;
  const [showChange, setShowChange] = useState(request.status === "pending");
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border-default bg-surface px-3.5 py-2.5">
      <span className="flex min-w-0 items-start gap-2.5">
        <Icon size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-muted" />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-sm text-fg">
            {request.title}
            {request.status !== "pending" && <Badge tone={status.tone}>{status.label}</Badge>}
          </span>
          <span className="block text-2xs text-fg-muted">
            asked by {request.agentName}
            {appName ? ` · ${appName}` : ""} · {new Date(request.createdAt).toLocaleString()}
          </span>
          {request.reason && (
            <span className="mt-1 block text-xs text-fg-secondary">“{request.reason}”</span>
          )}
          {request.result && (
            <span
              className={`mt-1 block text-2xs ${request.status === "failed" ? "text-danger" : "text-fg-secondary"}`}
            >
              {request.result}
            </span>
          )}
        </span>
      </span>
      {actions}
      {change && (
        <div className="w-full">
          <button
            type="button"
            className="text-2xs text-fg-secondary hover:text-fg"
            onClick={() => setShowChange((open) => !open)}
          >
            {showChange ? "Hide the change" : "Show the change"}
          </button>
          {showChange && (
            <div className="mt-1.5 flex max-h-96 min-h-0 flex-col overflow-hidden rounded-md border border-border-default">
              <TextDiff
                before={change.before}
                after={change.after}
                empty="The file is the same as now."
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Requests that change or run a pipeline; with an id, that pipeline only. */
export function forPipeline(pipelineId?: string) {
  return (request: AgentProposal) =>
    request.actionType.startsWith("pipeline.") &&
    (!pipelineId || request.payload.pipelineId === pipelineId);
}

/** Requests that act on what is deployed. */
export function forDeployments(request: AgentProposal): boolean {
  return (
    request.actionType === "app.action" ||
    request.actionType === "deploy.rollback" ||
    request.actionType === "deploy.promote"
  );
}

/** Video requests: approved in Video Studio, where the video is made and used. */
export function forStudio(request: AgentProposal): boolean {
  return request.actionType === "media.video";
}

/** Pushes: until an app's own page shows them, the Agents page is where they wait. */
export function forAgentsPage(request: AgentProposal): boolean {
  return request.actionType === "git.push";
}

const ELSEWHERE = [
  { label: "Pipelines", to: "/pipelines", matches: forPipeline() },
  { label: "Deployments", to: "/deployments", matches: forDeployments },
  { label: "Video Studio", to: "/studio/video", matches: forStudio },
] as const;

/**
 * What waits for a decision elsewhere — each request is approved where it is
 * used, not here — with the way there.
 */
export function WaitingElsewhere({ teamId }: { teamId: string }) {
  const requests = useQuery({
    queryKey: ["agent-requests", teamId],
    queryFn: () => api.agents.requests(teamId),
    refetchInterval: 15_000,
  });
  const waiting = (requests.data?.requests ?? []).filter((r) => r.status === "pending");
  const places = ELSEWHERE.map((place) => ({
    ...place,
    count: waiting.filter((request) => place.matches(request)).length,
  })).filter((place) => place.count > 0);
  if (places.length === 0) return null;
  return (
    <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/25 bg-warning-subtle px-3.5 py-2.5 text-xs text-fg">
      <span className="font-medium">Waiting for approval where they are used:</span>
      {places.map((place) => (
        <Link key={place.to} to={place.to} className="underline underline-offset-2 hover:text-fg">
          {place.count} in {place.label} →
        </Link>
      ))}
    </p>
  );
}
