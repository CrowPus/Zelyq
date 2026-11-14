import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OPS_TRUST_LEVELS,
  OPS_TRUST_WORDS,
  type OpsJobDetail,
  type OpsPlanStep,
  type OpsTrust,
  roleAtLeast,
} from "@zelyq/core";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  CircleDashed,
  Hand,
  Loader2,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Plus,
  Send,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Markdown } from "../components/Markdown";
import { AlertsTab } from "../components/ops/AlertsTab";
import { StatusTab } from "../components/ops/StatusTab";
import { Badge, Button, EmptyState, Input, Spinner, Textarea } from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { useLiveTalk } from "../lib/ops-live";
import { speak, spokenPart, stopSpeaking } from "../lib/ops-voice";
import { formatRelative, vaultErrorMessage } from "../lib/vault";

type Tab = "talk" | "status" | "alerts" | "memory" | "settings";

const STAGE_WORDS: Record<
  string,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  survey: { label: "Looking", tone: "info" },
  plan: { label: "Planning", tone: "info" },
  approve: { label: "Waiting for approval", tone: "warning" },
  act: { label: "Working", tone: "info" },
  record: { label: "Writing it down", tone: "info" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Not done", tone: "danger" },
  stopped: { label: "Stopped", tone: "neutral" },
};

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // a preference only
  }
}

/**
 * Ops, the team's DevOps engineer: talk to it (typed or aloud), read its plan,
 * approve what needs approval, see what it remembers, and set how much it may
 * do alone.
 */
export function OpsPage() {
  const { team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;
  const canTalk = team ? roleAtLeast(team.role, "editor") : false;
  // A link to /ops#status (from an alert email) opens that tab.
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    return (["talk", "status", "alerts", "memory", "settings"] as const).includes(wanted as Tab)
      ? (wanted as Tab)
      : "talk";
  });
  const queryClient = useQueryClient();
  const engineer = useQuery({
    queryKey: ["ops", teamId],
    queryFn: () => api.ops.get(teamId),
    enabled: Boolean(teamId),
  });
  const setUp = useMutation({
    mutationFn: () => api.ops.setUp(teamId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ops", teamId] }),
  });

  const status = engineer.data?.engineer;
  return (
    <AppShell crumbs={[{ label: "Ops" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
          <header className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">Ops</h1>
              <p className="text-xs text-fg-secondary">
                Your DevOps engineer. Tell it what you need, typed or aloud; it looks first, shows
                you a plan, and proves every change.
              </p>
            </div>
            {status && (
              <Badge tone={status.paused ? "warning" : "success"}>
                {status.paused ? "Paused" : "Ready"}
              </Badge>
            )}
          </header>

          {engineer.isLoading ? (
            <Spinner />
          ) : !status ? (
            <EmptyState
              title="Ops is not set up in this team"
              description={
                isAdmin
                  ? "Setting it up adds Ops to the team. It can do nothing until someone asks it, and changes to anything protected always wait for an admin."
                  : "A team admin sets it up once."
              }
              action={
                isAdmin ? (
                  <Button
                    variant="primary"
                    disabled={setUp.isPending}
                    onClick={() => setUp.mutate()}
                  >
                    Set up Ops
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <nav className="flex gap-1 border-b border-border-default" aria-label="Ops">
                {(["talk", "status", "alerts", "memory", "settings"] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTab(name)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                      tab === name
                        ? "border-primary font-medium text-fg"
                        : "border-transparent text-fg-secondary hover:text-fg"
                    }`}
                  >
                    {
                      {
                        talk: "Talk",
                        status: "Status",
                        alerts: "Alerts",
                        memory: "Memory",
                        settings: "Settings",
                      }[name]
                    }
                  </button>
                ))}
              </nav>
              {tab === "talk" && (
                <TalkTab teamId={teamId} canTalk={canTalk} paused={status.paused} />
              )}
              {tab === "status" && (
                <StatusTab teamId={teamId} canAnswer={canTalk} isAdmin={isAdmin} />
              )}
              {tab === "alerts" && <AlertsTab teamId={teamId} />}
              {tab === "memory" && (
                <MemoryTab teamId={teamId} isAdmin={isAdmin} canEdit={canTalk} />
              )}
              {tab === "settings" && <SettingsTab teamId={teamId} isAdmin={isAdmin} />}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ------------------------------------------------------------------- talking

function TalkTab({
  teamId,
  canTalk,
  paused,
}: {
  teamId: string;
  canTalk: boolean;
  paused: boolean;
}) {
  const queryClient = useQueryClient();
  // A link from an email opens its job (?job=…); it only shows it: approving is still a button.
  const [jobId, setJobId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("job"),
  );
  const jobs = useQuery({
    queryKey: ["ops-jobs", teamId],
    queryFn: () => api.ops.jobs(teamId),
    refetchInterval: 5000,
  });
  const job = useQuery({
    queryKey: ["ops-job", teamId, jobId],
    queryFn: () => api.ops.job(teamId, jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const data = query.state.data?.job;
      return data && (data.working || !["done", "failed", "stopped"].includes(data.stage))
        ? 1200
        : false;
    },
  });
  const current = job.data?.job ?? null;

  const [speakAloud, setSpeakAloud] = useState(() => readFlag("zelyq.ops.speak", true));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const talk = useMutation({
    mutationFn: (input: { text: string; spoken?: boolean }) =>
      api.ops.talk(teamId, { ...input, ...(jobId ? { jobId } : {}) }),
    onSuccess: ({ job: started }) => {
      setJobId(started.id);
      queryClient.setQueryData(["ops-job", teamId, started.id], { job: started });
      void queryClient.invalidateQueries({ queryKey: ["ops-jobs", teamId] });
      setDraft("");
      setError(null);
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  // Talking live: Ops hears you directly and answers in its own voice (Gemini Live, through
  // Zelyq's server); the job on screen follows the conversation.
  const live = useLiveTalk(teamId, {
    onJob: (id) => {
      setJobId(id);
      void queryClient.invalidateQueries({ queryKey: ["ops-jobs", teamId] });
    },
    onChanged: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-job", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["ops-jobs", teamId] });
    },
  });
  const talking = live.status !== "idle";

  // A typed conversation's new replies are read aloud (a live one speaks for itself).
  const heard = useRef<Set<string>>(new Set());
  const primed = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    if (primed.current !== current.id) {
      // Opening a job does not read out its whole history.
      primed.current = current.id;
      for (const message of current.messages) heard.current.add(message.id);
      return;
    }
    const fresh = current.messages.filter((message) => !heard.current.has(message.id));
    for (const message of fresh) heard.current.add(message.id);
    const reply = [...fresh].reverse().find((message) => message.role === "ops");
    if (reply && speakAloud && !talking) speak(spokenPart(reply.text));
  }, [current, speakAloud, talking]);

  useEffect(() => () => stopSpeaking(), []);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // While talking live, typed words join the conversation and Ops answers by voice.
    if (talking && live.say(text)) {
      setDraft("");
      return;
    }
    if (talk.isPending) return;
    talk.mutate({ text });
  };

  const newConversation = () => {
    stopSpeaking();
    if (talking) live.stop();
    setJobId(null);
    setDraft("");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside
        className={`${jobId ? "hidden lg:flex" : "flex"} flex-col gap-2 lg:h-[calc(100dvh-14rem)] lg:min-h-[420px] lg:overflow-y-auto`}
      >
        <Button icon={<Plus size={13} />} onClick={newConversation} disabled={!canTalk}>
          New conversation
        </Button>
        <ul className="flex flex-col gap-1">
          {(jobs.data?.jobs ?? []).map((row) => {
            const stage = STAGE_WORDS[row.stage] ?? { label: row.stage, tone: "neutral" as const };
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setJobId(row.id)}
                  className={`flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs hover:border-border-strong ${
                    row.id === jobId
                      ? "border-primary bg-surface"
                      : "border-border-default bg-surface-subtle"
                  }`}
                >
                  <span className="line-clamp-2 text-fg">{row.request}</span>
                  <span className="flex items-center gap-2 text-fg-muted">
                    <Badge tone={stage.tone}>{stage.label}</Badge>
                    {formatRelative(row.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex h-[calc(100dvh-14rem)] min-h-[420px] flex-col overflow-hidden rounded-md border border-border-default bg-surface">
        {current ? (
          <Conversation teamId={teamId} job={current} onBack={() => setJobId(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-fg-secondary">
            <p className="font-medium text-fg">What do you need?</p>
            <p className="max-w-md text-xs">
              For example: “Put my shop online at myshop.com”, “Is everything OK?”, “Ship the latest
              version”, “Why was the site down last night?”. Type it, or press the microphone and
              just talk: Ops answers aloud.
            </p>
          </div>
        )}

        <form onSubmit={send} className="border-t border-border-default p-3">
          {paused && (
            <p className="mb-2 text-xs text-warning">
              Ops is paused. An admin resumes it in Settings.
            </p>
          )}
          {(error || live.error) && (
            <p className="mb-2 text-xs text-danger">{error ?? live.error}</p>
          )}
          {talking && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-surface-subtle px-3 py-2">
              <span
                className={`size-2.5 rounded-full ${live.speaking ? "animate-pulse bg-primary" : live.status === "live" ? "bg-success" : "animate-pulse bg-fg-muted"}`}
              />
              <span className="text-xs font-medium text-fg">
                {live.status === "connecting"
                  ? "Connecting…"
                  : live.speaking
                    ? "Ops is talking — just speak to interrupt"
                    : live.working
                      ? "Ops is working…"
                      : live.muted
                        ? "Muted — Ops cannot hear you"
                        : "Listening — just talk"}
              </span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="secondary" onClick={live.toggleMute}>
                  {live.muted ? <MicOff size={13} /> : <Mic size={13} />}
                  {live.muted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="danger" onClick={live.stop}>
                  <PhoneOff size={13} /> End
                </Button>
              </span>
              {live.caption && (
                <p className="w-full text-sm text-fg-secondary">
                  <span className="font-medium text-fg">
                    {live.caption.role === "ops" ? "Ops: " : "You: "}
                  </span>
                  {live.caption.text}
                </p>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Message to Ops"
              rows={2}
              value={draft}
              disabled={!canTalk || paused}
              placeholder={canTalk ? "Tell Ops what you need…" : "Editors and admins talk to Ops."}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="min-h-[52px] flex-1 resize-none"
            />
            <div className="flex flex-col gap-1">
              <Button
                variant={talking ? "danger" : "secondary"}
                aria-label={talking ? "End the conversation" : "Talk to Ops"}
                title={
                  talking ? "End the conversation" : "Talk to Ops: it listens and answers aloud"
                }
                disabled={!canTalk || paused}
                onClick={() => {
                  stopSpeaking();
                  if (talking) live.stop();
                  else live.start(jobId);
                }}
              >
                {talking ? <PhoneOff size={14} /> : <Mic size={14} />}
              </Button>
              <Button
                type="submit"
                variant="primary"
                aria-label="Send"
                disabled={!canTalk || paused || !draft.trim() || (!talking && talk.isPending)}
              >
                {talk.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-secondary">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={speakAloud}
                onChange={(event) => {
                  setSpeakAloud(event.target.checked);
                  writeFlag("zelyq.ops.speak", event.target.checked);
                  if (!event.target.checked) stopSpeaking();
                }}
              />
              {speakAloud ? <Volume2 size={12} /> : <VolumeX size={12} />} Read replies aloud
            </label>
            <span className="text-fg-muted">
              Approving always takes a button, never your voice.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}

function Conversation({
  teamId,
  job,
  onBack,
}: {
  teamId: string;
  job: OpsJobDetail;
  /** On a phone, back to the list of conversations. */
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const list = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["ops-job", teamId, job.id] });
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api.ops.decide(teamId, job.id, {
        decision,
        planHash: job.planHash ?? "",
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    onSuccess: ({ job: updated }) => {
      queryClient.setQueryData(["ops-job", teamId, job.id], { job: updated });
      setComment("");
      setError(null);
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const confirm = useMutation({
    mutationFn: (stepId: string) => api.ops.confirmStep(teamId, job.id, stepId),
    onSuccess: refresh,
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const stop = useMutation({ mutationFn: () => api.ops.stop(teamId, job.id), onSuccess: refresh });

  const count = job.messages.length + job.activity.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when something new arrives
  useEffect(() => {
    // Only the conversation scrolls; the message box stays where it is.
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count]);

  const stage = STAGE_WORDS[job.stage] ?? { label: job.stage, tone: "neutral" as const };
  const live = !["done", "failed", "stopped"].includes(job.stage);
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border-default px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="All conversations"
          className="-ml-1 rounded p-1 text-fg-secondary hover:bg-surface-subtle lg:hidden"
        >
          <ArrowLeft size={16} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={job.request}>
          {job.request}
        </p>
        <Badge tone={stage.tone}>{stage.label}</Badge>
        {job.tokens > 0 && (
          <span className="text-2xs text-fg-muted">{job.tokens.toLocaleString()} tokens</span>
        )}
        {live && (
          <Button size="sm" variant="ghost" icon={<Ban size={12} />} onClick={() => stop.mutate()}>
            Stop
          </Button>
        )}
      </header>

      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {job.messages.map((message) =>
          message.role === "system" ? (
            <p key={message.id} className="text-center text-2xs text-fg-muted">
              {message.text}
            </p>
          ) : (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === "person"
                  ? "self-end bg-primary/10 text-fg"
                  : "self-start border border-border-default bg-surface-subtle"
              }`}
            >
              <p className="mb-0.5 text-2xs text-fg-muted">
                {message.role === "ops" ? "Ops" : (message.author ?? "You")} ·{" "}
                {formatRelative(message.at)}
              </p>
              {message.role === "ops" ? (
                <Markdown>{message.text}</Markdown>
              ) : (
                <p className="whitespace-pre-wrap">{message.text}</p>
              )}
            </div>
          ),
        )}

        {job.steps.length > 0 && (
          <PlanCard
            job={job}
            onConfirm={(stepId) => confirm.mutate(stepId)}
            confirming={confirm.isPending}
          />
        )}

        {job.stage === "approve" && (
          <div className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm">
            <p className="font-medium">This plan waits for your approval.</p>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Read each step above. Approving lets Ops do exactly these steps, nothing else.
            </p>
            {job.canApprove ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Why not (optional)"
                  placeholder="If you reject it: what should change? Ops remembers it."
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="min-w-[220px] flex-1"
                />
                <Button
                  variant="primary"
                  icon={<Check size={13} />}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate("approve")}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  icon={<XCircle size={13} />}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate("reject")}
                >
                  Reject
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-fg-secondary">{job.approveBlockedBy}</p>
            )}
          </div>
        )}

        {job.working && (
          <div className="flex items-start gap-2 text-xs text-fg-secondary">
            <Loader2 size={13} className="mt-0.5 animate-spin" />
            <div>
              <p>Ops is working…</p>
              {job.activity.slice(-4).map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a running list, newest last
                <p key={index} className="text-fg-muted">
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
        {!job.working && job.activity.length > 0 && (
          <details className="text-xs text-fg-secondary">
            <summary className="cursor-pointer select-none">
              What Ops looked at and did ({job.activity.length})
            </summary>
            <ol className="mt-1 list-decimal pl-5 text-fg-muted">
              {job.activity.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed record, in order
                <li key={index}>{line}</li>
              ))}
            </ol>
          </details>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </>
  );
}

const STEP_ICON: Record<OpsPlanStep["status"], typeof CheckCircle2> = {
  planned: CircleDashed,
  running: Loader2,
  done: CheckCircle2,
  failed: XCircle,
  skipped: Ban,
  not_verified: Hand,
  replaced: Ban,
};

function PlanCard({
  job,
  onConfirm,
  confirming,
}: {
  job: OpsJobDetail;
  onConfirm: (stepId: string) => void;
  confirming: boolean;
}) {
  return (
    <div className="rounded-md border border-border-default p-3">
      <p className="mb-2 text-xs font-medium text-fg-secondary">
        The plan{job.planApprovedBy ? ` — approved by ${job.planApprovedBy}` : ""}
      </p>
      <ol className="flex flex-col gap-2">
        {job.steps.map((step) => {
          const Icon = STEP_ICON[step.status];
          const tone =
            step.status === "done"
              ? "text-success"
              : step.status === "failed"
                ? "text-danger"
                : step.status === "not_verified"
                  ? "text-warning"
                  : "text-fg-muted";
          return (
            <li key={step.id} className="flex items-start gap-2 text-sm">
              <Icon
                size={15}
                className={`mt-0.5 shrink-0 ${tone} ${step.status === "running" ? "animate-spin" : ""}`}
              />
              <div className="min-w-0 flex-1">
                <p>
                  {step.position + 1}. {step.words}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
                  {step.risk === "always-ask" && <Badge tone="danger">Cannot be undone</Badge>}
                  {step.needsApproval && step.risk !== "always-ask" && (
                    <Badge tone="warning">Needs approval</Badge>
                  )}
                  {step.undo && <span>Way back: {step.undo}</span>}
                </p>
                {step.proof && (
                  <p
                    className={`mt-0.5 text-2xs ${step.proof.ok ? "text-success" : "text-danger"}`}
                  >
                    Checked by Zelyq: {step.proof.ok ? "it worked" : "it did not work"}
                    {step.proof.detail ? ` — ${step.proof.detail}` : ""}
                  </p>
                )}
                {step.status === "replaced" && (
                  <p className="mt-0.5 text-2xs text-fg-muted">
                    Did not work{step.result ? ` (${step.result})` : ""}; a later plan took its
                    place.
                  </p>
                )}
                {step.status === "not_verified" && (
                  <p className="mt-0.5 text-2xs text-warning">
                    Done, but not checked: treat it as unproven.
                  </p>
                )}
                {step.risk === "always-ask" &&
                  step.status === "planned" &&
                  job.planApprovedBy &&
                  step.needsApproval &&
                  job.canApprove !== undefined && (
                    <Button
                      size="sm"
                      variant="danger"
                      className="mt-1"
                      disabled={confirming}
                      onClick={() => {
                        if (
                          window.confirm(
                            `This cannot be undone:\n\n${step.words}\n\nConfirm this one step?`,
                          )
                        ) {
                          onConfirm(step.id);
                        }
                      }}
                    >
                      Confirm this step
                    </Button>
                  )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------- memory

function MemoryTab({
  teamId,
  isAdmin,
  canEdit,
}: {
  teamId: string;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const memory = useQuery({
    queryKey: ["ops-memory", teamId],
    queryFn: () => api.ops.memory(teamId),
  });
  const [wish, setWish] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = (data: Awaited<ReturnType<typeof api.ops.memory>>) => {
    queryClient.setQueryData(["ops-memory", teamId], data);
    setError(null);
  };
  const failed = (caught: unknown) => setError(vaultErrorMessage(caught));
  const addWish = useMutation({
    mutationFn: () => api.ops.addWish(teamId, { text: wish.trim() }),
    onSuccess: (data) => {
      done(data);
      setWish("");
    },
    onError: failed,
  });
  const change = useMutation({
    mutationFn: (work: () => ReturnType<typeof api.ops.memory>) => work(),
    onSuccess: done,
    onError: failed,
  });

  if (memory.isLoading) return <Spinner />;
  const data = memory.data;
  if (!data) return null;
  return (
    <div className="grid gap-6">
      {error && <p className="text-xs text-danger">{error}</p>}
      <section>
        <h2 className="text-sm font-semibold">What the team wants</h2>
        <p className="mb-2 text-xs text-fg-secondary">
          Ops reads these before every job, and a person's word beats its own conclusions.
        </p>
        {canEdit && (
          <form
            className="mb-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (wish.trim()) addWish.mutate();
            }}
          >
            <Input
              aria-label="A wish"
              placeholder="For example: never deploy on Friday afternoon"
              value={wish}
              onChange={(event) => setWish(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!wish.trim() || addWish.isPending}>
              Add
            </Button>
          </form>
        )}
        <ul className="flex flex-col gap-1">
          {data.wishes.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-md border border-border-default px-2.5 py-1.5 text-sm"
            >
              <span className={`min-w-0 flex-1 ${row.active ? "" : "text-fg-muted line-through"}`}>
                {row.text}
              </span>
              {row.scope !== "team" && <Badge>{row.scope}</Badge>}
              <span className="text-2xs text-fg-muted">
                {row.source === "correction" ? "from a correction" : "added"}
              </span>
              {canEdit && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      change.mutate(() => api.ops.editWish(teamId, row.id, { active: !row.active }))
                    }
                  >
                    {row.active ? "Switch off" : "Switch on"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => change.mutate(() => api.ops.removeWish(teamId, row.id))}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
          {data.wishes.length === 0 && <li className="text-xs text-fg-muted">None yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold">What Ops learned</h2>
        <p className="mb-2 text-xs text-fg-secondary">
          Each lesson comes from something that went wrong or something a person said, shown as its
          evidence. Retire one that is no longer true.
        </p>
        <ul className="flex flex-col gap-2">
          {data.lessons.map((row) => (
            <li key={row.id} className="rounded-md border border-border-default p-2.5 text-sm">
              <p
                className={row.status === "retired" ? "text-fg-muted line-through" : "font-medium"}
              >
                {row.rule}
              </p>
              <p className="mt-0.5 text-xs text-fg-secondary">Because {row.why}</p>
              {row.evidence && (
                <p className="mt-0.5 text-2xs text-fg-muted">Evidence: {row.evidence}</p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
                <Badge tone={row.strength === "reminder" ? "neutral" : "info"}>
                  {row.strength === "reminder"
                    ? "Reminder"
                    : row.strength === "block"
                      ? "A person does it"
                      : "Checked before steps"}
                </Badge>
                {row.lastMatchedAt && (
                  <span>Last mattered {formatRelative(row.lastMatchedAt)}</span>
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      change.mutate(() =>
                        api.ops.editLesson(teamId, row.id, {
                          status: row.status === "retired" ? "active" : "retired",
                          ...(row.status === "retired"
                            ? {}
                            : { retiredReason: "Retired on the Memory tab" }),
                        }),
                      )
                    }
                  >
                    {row.status === "retired" ? "Bring back" : "Retire"}
                  </Button>
                )}
              </p>
            </li>
          ))}
          {data.lessons.length === 0 && <li className="text-xs text-fg-muted">Nothing yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Checks Zelyq runs before Ops's steps</h2>
        <p className="mb-2 text-xs text-fg-secondary">
          Switched on by lessons, so the same mistake cannot happen twice. Only an admin switches
          one off; Ops never can.
        </p>
        <ul className="flex flex-col gap-1">
          {data.guards.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-md border border-border-default px-2.5 py-1.5 text-sm"
            >
              <span className={`min-w-0 flex-1 ${row.active ? "" : "text-fg-muted line-through"}`}>
                {row.words}
              </span>
              {row.scope !== "team" && <Badge>{row.scope}</Badge>}
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    change.mutate(() => api.ops.switchCheck(teamId, row.id, !row.active))
                  }
                >
                  {row.active ? "Switch off" : "Switch on"}
                </Button>
              )}
            </li>
          ))}
          {data.guards.length === 0 && <li className="text-xs text-fg-muted">None yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold">What Ops knows</h2>
        <p className="mb-2 text-xs text-fg-secondary">
          One sheet per app, environment and machine: how it is built, deployed and restored. Every
          version is kept.
        </p>
        <div className="flex flex-col gap-2">
          {data.sheets.map((row) => (
            <SheetCard
              key={row.id}
              teamId={teamId}
              sheet={row}
              canEdit={canEdit}
              onSaved={done}
              onError={failed}
            />
          ))}
          {data.sheets.length === 0 && <p className="text-xs text-fg-muted">None yet.</p>}
        </div>
      </section>
    </div>
  );
}

function SheetCard({
  teamId,
  sheet,
  canEdit,
  onSaved,
  onError,
}: {
  teamId: string;
  sheet: { subject: string; body: string; version: number; updatedBy: string; updatedAt: string };
  canEdit: boolean;
  onSaved: (data: Awaited<ReturnType<typeof api.ops.memory>>) => void;
  onError: (caught: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(sheet.body);
  const save = useMutation({
    mutationFn: () => api.ops.writeSheet(teamId, { subject: sheet.subject, body }),
    onSuccess: (data) => {
      onSaved(data);
      setEditing(false);
    },
    onError,
  });
  return (
    <div className="rounded-md border border-border-default p-2.5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className="flex-1">{sheet.subject}</span>
        <span className="text-2xs font-normal text-fg-muted">
          v{sheet.version} · {sheet.updatedBy} · {formatRelative(sheet.updatedAt)}
        </span>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </p>
      {editing ? (
        <div className="mt-2 grid gap-2">
          <Textarea
            aria-label={`Sheet for ${sheet.subject}`}
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm">
          <Markdown>{sheet.body}</Markdown>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SettingsTab({ teamId, isAdmin }: { teamId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const engineer = useQuery({ queryKey: ["ops", teamId], queryFn: () => api.ops.get(teamId) });
  const environments = useQuery({
    queryKey: ["ops-environments", teamId],
    queryFn: () => api.ops.environments(teamId),
  });
  const status = engineer.data?.engineer;
  const [cap, setCap] = useState("");
  const [zone, setZone] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    setCap(status.monthlyTokenCap === null ? "" : String(status.monthlyTokenCap));
    setZone(status.timeZone);
  }, [status]);
  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.ops.update>[1]) => api.ops.update(teamId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops", teamId] });
      setError(null);
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const trust = useMutation({
    mutationFn: (input: { environmentId: string; trust: OpsTrust }) =>
      api.ops.setTrust(teamId, input.environmentId, input.trust),
    onSuccess: (data) => queryClient.setQueryData(["ops-environments", teamId], data),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const used = useMemo(() => status?.tokensThisMonth ?? 0, [status]);
  if (!status) return <Spinner />;
  return (
    <div className="grid max-w-3xl gap-6">
      {error && <p className="text-xs text-danger">{error}</p>}
      {!isAdmin && <p className="text-xs text-fg-secondary">Only a team admin changes these.</p>}

      <section className="flex flex-wrap items-center gap-3 rounded-md border border-border-default p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{status.paused ? "Ops is paused" : "Ops is on"}</p>
          <p className="text-xs text-fg-secondary">
            Pausing stops everything Ops is doing and keeps it from starting anything new.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant={status.paused ? "primary" : "danger"}
            icon={status.paused ? <Play size={13} /> : <Pause size={13} />}
            disabled={update.isPending}
            onClick={() => update.mutate({ paused: !status.paused })}
          >
            {status.paused ? "Resume Ops" : "Pause Ops"}
          </Button>
        )}
      </section>

      <section className="grid gap-2 rounded-md border border-border-default p-3">
        <p className="text-sm font-medium">Spending</p>
        <p className="text-xs text-fg-secondary">
          This month: {used.toLocaleString()} tokens
          {status.monthlyTokenCap !== null ? ` of ${status.monthlyTokenCap.toLocaleString()}` : ""}.
          When the limit is reached, Ops starts no new work; checks and alerts keep running.
        </p>
        {isAdmin && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                monthlyTokenCap:
                  cap.trim() === "" ? null : Math.max(0, Math.floor(Number(cap) || 0)),
                timeZone: zone.trim() || "UTC",
              });
            }}
          >
            <label htmlFor="ops-month-cap" className="grid gap-1 text-2xs text-fg-secondary">
              Monthly limit (tokens)
              <Input
                id="ops-month-cap"
                aria-label="Monthly limit in tokens"
                placeholder="No limit"
                value={cap}
                onChange={(event) => setCap(event.target.value)}
                className="w-40"
              />
            </label>
            <label htmlFor="ops-time-zone" className="grid gap-1 text-2xs text-fg-secondary">
              Time zone
              <Input
                id="ops-time-zone"
                aria-label="Time zone"
                placeholder="Europe/London"
                value={zone}
                onChange={(event) => setZone(event.target.value)}
                className="w-48"
              />
            </label>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </form>
        )}
        <p className="text-2xs text-fg-muted">
          The time zone is used for "nightly", quiet hours and no-change times.
        </p>
      </section>

      <section className="grid gap-2">
        <p className="text-sm font-medium">How much Ops may do on its own</p>
        <p className="text-xs text-fg-secondary">
          Per environment. Whatever you choose, deleting data, removing machines, pointing domains
          and spending money always wait for a person.
        </p>
        <ul className="grid gap-2">
          {(environments.data?.environments ?? []).map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-default px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-sm font-medium">
                {row.name} {row.protected && <Badge tone="warning">Protected</Badge>}{" "}
                {row.frozen && <Badge tone="danger">Frozen</Badge>}
              </span>
              <select
                aria-label={`How much Ops may do on ${row.name}`}
                value={row.trust}
                disabled={!isAdmin || trust.isPending}
                onChange={(event) =>
                  trust.mutate({ environmentId: row.id, trust: event.target.value as OpsTrust })
                }
                className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm"
              >
                {OPS_TRUST_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {OPS_TRUST_WORDS[level].label}
                  </option>
                ))}
              </select>
              <p className="w-full text-2xs text-fg-muted">
                {OPS_TRUST_WORDS[row.trust].description}
              </p>
            </li>
          ))}
          {(environments.data?.environments.length ?? 0) === 0 && (
            <li className="text-xs text-fg-muted">No environments yet. Ask Ops to set them up.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
