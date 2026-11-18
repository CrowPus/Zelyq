import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type LocalRunnerStatus,
  RUNNER_USER,
  type RunnerOs,
  type RunnerSummary,
  type RunnerTestResult,
  roleAtLeast,
  runnerSetupScript,
  type TeamMembership,
} from "@zelyq/core";
import {
  Check,
  Copy,
  HardDrive,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  RotateCw,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { formatDate, formatNumber } from "../../lib/format";
import { t } from "../../lib/i18n";
import { formatRelative, vaultErrorMessage } from "../../lib/vault";
import {
  Badge,
  Button,
  confirmAction,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  Spinner,
} from "../ui";

const OS_LABEL: Record<string, string> = {
  linux: t("Linux"),
  macos: "macOS",
  windows: t("Windows"),
};

/**
 * The team's machines. Three steps for each, in the order they are needed:
 * put the team's key on the machine, add it here, test and confirm it.
 */
export function RunnersTab({ team }: { team: TeamMembership }) {
  const isAdmin = roleAtLeast(team.role, "admin");
  const runners = useQuery({
    queryKey: ["runners", team.id],
    queryFn: () => api.runners.list(team.id),
    refetchInterval: 10_000,
  });
  const [adding, setAdding] = useState(false);

  return (
    <div className="grid gap-6">
      <LocalRunnerNote status={runners.data?.local ?? null} />
      {isAdmin ? (
        <TeamKey teamId={team.id} />
      ) : (
        <p className="text-xs text-fg-secondary">
          {t("A team admin adds runners and manages the team’s SSH key.")}
        </p>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("SSH runners")}</h2>
          {isAdmin && !adding && (
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
              {t("Add runner")}
            </Button>
          )}
        </div>
        {adding && <RunnerForm teamId={team.id} onDone={() => setAdding(false)} />}
        {runners.isLoading ? (
          <Spinner />
        ) : (runners.data?.runners.length ?? 0) === 0 ? (
          !adding && (
            <EmptyState
              title={t("No SSH runners")}
              description={t(
                "Any Linux, macOS or Windows machine with an SSH server can run pipelines: a VM, a Mac mini, a build box.",
              )}
            />
          )
        ) : (
          <ul className="grid gap-2">
            {runners.data?.runners.map((runner) => (
              <RunnerRow key={runner.id} teamId={team.id} runner={runner} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LocalRunnerNote({ status }: { status: LocalRunnerStatus | null }) {
  return (
    <div className="flex gap-3 rounded-md border border-border-default bg-surface-subtle p-3 text-xs text-fg-secondary">
      <Server size={16} className="mt-0.5 shrink-0" />
      <div className="grid gap-1">
        <p>
          {t(
            "{part} — always here. A pipeline with {code} runs on this Zelyq server, in a fresh container that is thrown away afterwards. A server admin can change this in Server admin → Pipelines.",
            {
              part: <span className="font-medium text-fg">{t("Local runner")}</span>,
              code: <code className="font-mono">runs-on: local</code>,
            },
          )}
        </p>
        {status && !status.off && (
          <p className="flex flex-wrap items-center gap-2">
            <Badge
              tone={status.busy >= status.places ? "warning" : status.busy > 0 ? "info" : "success"}
            >
              {status.busy > 0
                ? t("Running {busy} of {places}", { busy: status.busy, places: status.places })
                : t("Ready")}
            </Badge>
            {t("Takes {value} at once{value2}", {
              value:
                status.places === 1 ? t("1 run") : t("{places} runs", { places: status.places }),
              value2: status.automatic
                ? t(": automatic, from this server’s processors and memory.")
                : t(" (set by hand)."),
            })}
          </p>
        )}
        {status?.off && <p>{t("Turned off on this instance.")}</p>}
      </div>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? t("Copied") : label}
    </Button>
  );
}

function TeamKey({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const keys = useQuery({
    queryKey: ["ssh-keys", teamId],
    queryFn: () => api.runners.keys(teamId),
  });
  const [error, setError] = useState<string | null>(null);
  const [os, setOs] = useState<RunnerOs>("linux");
  const [user, setUser] = useState("zelyq");
  const [admin, setAdmin] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ssh-keys", teamId] });
  const rotate = useMutation({
    mutationFn: (algorithm: "ed25519" | "rsa") => api.runners.rotateKey(teamId, algorithm),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const retire = useMutation({
    mutationFn: () => api.runners.retireOldKeys(teamId),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  if (keys.isLoading) return <Spinner />;
  const [current, ...older] = keys.data?.keys ?? [];
  if (!current) return null;
  const userOk = RUNNER_USER.test(user);
  const command = userOk
    ? runnerSetupScript({ os, user, publicKey: current.publicKey, admin })
    : "";

  return (
    <section className="rounded-md border border-border-default p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound size={14} /> {t("The team’s SSH key")}
        </h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCw size={13} />}
            disabled={rotate.isPending}
            onClick={async () => {
              if (
                await confirmAction({
                  title: t("Make a new key?"),
                  description: t(
                    "The current one keeps working for 7 days while you add the new one to each machine.",
                  ),
                  confirmLabel: t("Make a new key"),
                })
              ) {
                rotate.mutate(current.algorithm);
              }
            }}
          >
            {t("New key")}
          </Button>
        </div>
      </div>
      <p className="mb-2 text-xs text-fg-secondary">
        {t(
          "Step 1 for every machine: set it up. Paste this once on the machine, as a user who can use sudo (on Windows: PowerShell, Run as administrator). It creates the runner’s user, lets this team’s key in, and joins the docker group if Docker is there. Running it again is safe.",
        )}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex gap-1">
          {(["linux", "macos", "windows"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setOs(value)}
              className={`rounded px-2 py-0.5 ${os === value ? "bg-surface-hover font-medium" : "text-fg-secondary"}`}
            >
              {OS_LABEL[value]}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1">
          {t("User to create")}
          <Input
            aria-label={t("User to create")}
            value={user}
            onChange={(event) => setUser(event.target.value.trim())}
            className="h-6 w-28 font-mono text-xs"
          />
        </span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={admin}
            onChange={(event) => setAdmin(event.target.checked)}
          />
          {os === "windows" ? t("Make it an administrator") : t("Let it use sudo")}
        </label>
      </div>
      {admin && (
        <p className="mb-2 rounded bg-warning-subtle p-2 text-2xs">
          {t(
            "Then every pipeline that runs here can do anything on this machine. Leave it off unless your steps install system packages.",
          )}
        </p>
      )}
      {userOk ? (
        <pre className="mb-2 max-h-64 overflow-auto rounded bg-surface-subtle p-2 font-mono text-2xs whitespace-pre">
          {command}
        </pre>
      ) : (
        <p className="mb-2 text-xs text-danger">
          {t("Use lower-case letters, digits, ’_’ or ’-’ for the user.")}
        </p>
      )}
      {os === "macos" && (
        <p className="mb-2 text-2xs text-fg-secondary">
          {t("Remote Login must be on: System Settings → General → Sharing → Remote Login.")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={command} label={t("Copy command")} />
        <CopyButton text={current.publicKey} label={t("Copy key only")} />
        <span className="font-mono text-2xs text-fg-muted">
          {current.algorithm} · {current.fingerprint}
        </span>
      </div>
      {older.map((key) => (
        <div key={key.id} className="mt-3 rounded bg-warning-subtle p-2 text-xs">
          {t("The previous key ({fingerprint}) still works until ", {
            fingerprint: key.fingerprint,
          })}
          {key.retiresAt ? formatDate(key.retiresAt) : t("removed")}
          {t(". Add the new key to every machine, then ")}
          <button type="button" className="underline" onClick={() => retire.mutate()}>
            {t("stop the old key now")}
          </button>
          .
        </div>
      ))}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

/** Adds a runner, or — given one — changes it. */
/** "Takes 4 runs at once — automatic, from 8 processors and 31 GB of memory." */
function capacityWords(runner: RunnerSummary): string {
  const runs =
    runner.concurrency === 1
      ? "1 run"
      : t("{concurrency} runs", { concurrency: runner.concurrency });
  if (runner.maxConcurrent > 0) return t("Takes {runs} at once (set by hand).", { runs });
  if (!runner.cpus) {
    return t(
      "Takes {runs} at once for now; Test connection lets Zelyq size it from its processors and memory.",
      { runs },
    );
  }
  const memory = runner.memoryMb
    ? t(" and {memoryMb} GB of memory", { memoryMb: Math.round(runner.memoryMb / 1024) })
    : "";
  return t("Takes {runs} at once: automatic, from {cpus} processors{memory}.", {
    runs,
    cpus: runner.cpus,
    memory,
  });
}

function RunnerForm({
  teamId,
  runner,
  onDone,
}: {
  teamId: string;
  runner?: RunnerSummary;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: runner?.name ?? "",
    host: runner?.host ?? "",
    port: String(runner?.port ?? 22),
    username: runner?.username ?? "zelyq",
    labels: runner?.labels.join(", ") ?? "",
    // Empty is automatic: from the machine's processors and memory.
    maxConcurrent: runner && runner.maxConcurrent > 0 ? String(runner.maxConcurrent) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        labels: form.labels
          .split(",")
          .map((label) => label.trim().toLowerCase())
          .filter(Boolean),
        maxConcurrent: Math.max(0, Math.floor(Number(form.maxConcurrent) || 0)),
      };
      return runner
        ? api.runners.update(teamId, runner.id, input)
        : api.runners.create(teamId, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["runners", teamId] });
      onDone();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const field = (key: keyof typeof form, label: string, placeholder: string, className = "") => (
    <div className={`grid gap-1 ${className}`}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        aria-label={label}
        value={form[key]}
        placeholder={placeholder}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </div>
  );
  return (
    <form
      className="mb-3 grid gap-3 rounded-md border border-border-default p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="text-xs text-fg-secondary">
        {runner
          ? t(
              "Change what you need. A new host or port means confirming the machine’s fingerprint again.",
            )
          : t("Step 2: where the machine is. After adding it, press Test connection.")}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field("name", "Name", "build-01")}
        {field("host", "Host or IP", "10.0.0.5", "col-span-1 sm:col-span-2")}
        {field("port", "Port", "22")}
        {field("username", "SSH user", "deploy")}
        {field("labels", "Labels", "docker, gpu", "col-span-1 sm:col-span-2")}
        {field("maxConcurrent", "Runs at once", "Automatic")}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={create.isPending || !form.name || !form.host || !form.username}
        >
          {runner ? t("Save") : t("Add runner")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

function RunnerRow({
  teamId,
  runner,
  isAdmin,
}: {
  teamId: string;
  runner: RunnerSummary;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RunnerTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["runners", teamId] });
  const test = useMutation({
    mutationFn: () => api.runners.test(teamId, runner.id),
    onSuccess: (next) => {
      setResult(next);
      setError(null);
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const confirm = useMutation({
    mutationFn: (fingerprint: string) => api.runners.confirm(teamId, runner.id, fingerprint),
    onSuccess: () => {
      setResult(null);
      void refresh();
    },
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const toggle = useMutation({
    mutationFn: () => api.runners.update(teamId, runner.id, { enabled: !runner.enabled }),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });
  const remove = useMutation({
    mutationFn: () => api.runners.remove(teamId, runner.id),
    onSuccess: () => void refresh(),
    onError: (caught) => setError(vaultErrorMessage(caught)),
  });

  const confirmed = Boolean(runner.hostKeyFingerprint);
  const state = !runner.enabled
    ? { tone: "neutral" as const, label: t("Off") }
    : !confirmed
      ? { tone: "warning" as const, label: t("Not confirmed") }
      : runner.lastTest && !runner.lastTest.ok
        ? { tone: "danger" as const, label: t("Unreachable") }
        : runner.busyRuns > 0
          ? {
              tone: (runner.busyRuns >= runner.concurrency ? "warning" : "info") as
                | "warning"
                | "info",
              label: t("Running {busyRuns} of {concurrency}", {
                busyRuns: runner.busyRuns,
                concurrency: runner.concurrency,
              }),
            }
          : { tone: "success" as const, label: t("Ready") };

  if (editing) {
    return (
      <li>
        <RunnerForm teamId={teamId} runner={runner} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="rounded-md border border-border-default p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{runner.name}</span>
        <Badge tone={state.tone}>{state.label}</Badge>
        {runner.os && <Badge>{OS_LABEL[runner.os] ?? runner.os}</Badge>}
        {runner.labels.map((label) => (
          <Badge key={label} tone="info">
            {label}
          </Badge>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {isAdmin && (
            <>
              <Button
                size="sm"
                icon={<Plug size={13} />}
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? t("Testing…") : t("Test connection")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil size={13} />}
                onClick={() => setEditing(true)}
              >
                {t("Edit")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate()}>
                {runner.enabled ? t("Turn off") : t("Turn on")}
              </Button>
              <IconButton
                size="sm"
                variant="danger"
                label={t("Remove runner")}
                onClick={async () => {
                  if (
                    await confirmAction({
                      title: t("Remove {name}?", { name: runner.name }),
                      description: t(
                        "Pipelines that name it will fail until another runner matches.",
                      ),
                      confirmLabel: t("Remove machine"),
                      danger: true,
                    })
                  ) {
                    remove.mutate();
                  }
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </>
          )}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-fg-secondary">
        {runner.username}@{runner.host}:{runner.port}
        {runner.shells.length + runner.tools.length > 0 && (
          <span className="font-sans">
            {" "}
            {t("· has")} {[...runner.shells, ...runner.tools].join(", ")}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-fg-secondary">{capacityWords(runner)}</p>
      {runner.lastTest && (
        <p className={`mt-1 text-xs ${runner.lastTest.ok ? "text-fg-secondary" : "text-danger"}`}>
          {runner.lastTest.message} ({formatRelative(runner.lastTest.at)})
        </p>
      )}
      {confirmed && isAdmin && <DiskUse teamId={teamId} runnerId={runner.id} />}
      {confirmed && (
        <p className="mt-1 flex items-center gap-1 text-2xs text-fg-muted">
          <ShieldCheck size={12} />{" "}
          {t("Only talks to {hostKeyFingerprint}", {
            hostKeyFingerprint: runner.hostKeyFingerprint,
          })}
        </p>
      )}
      {result?.needsConfirmation && result.hostKeyFingerprint && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-subtle p-3 text-xs">
          <p className="font-medium">{t("Step 3: is this really your machine?")}</p>
          <p className="mt-1">{t("It says its fingerprint is")}</p>
          <p className="my-1 font-mono text-sm break-all">{result.hostKeyFingerprint}</p>
          <p className="text-fg-secondary">
            {t("Check on the machine itself — one of the lines this prints must match:")}
          </p>
          <pre className="my-1 overflow-x-auto rounded bg-surface p-2 font-mono text-2xs">
            {runner.os === "windows"
              ? "Get-ChildItem C:\\ProgramData\\ssh\\ssh_host_*_key.pub | ForEach-Object { ssh-keygen -lf $_.FullName }"
              : 'for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done'}
          </pre>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate(result.hostKeyFingerprint as string)}
            >
              {t("It matches — confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              {t("Not now")}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

/** What Zelyq keeps on the machine (tools, caches) and the room left, on request. */
function DiskUse({ teamId, runnerId }: { teamId: string; runnerId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const disk = useQuery({
    queryKey: ["runner-disk", teamId, runnerId],
    queryFn: () => api.runners.disk(teamId, runnerId),
    enabled: open,
  });
  const clear = useMutation({
    mutationFn: (what: "tools" | "cache") => api.runners.clearDisk(teamId, runnerId, what),
    onSuccess: (next) => queryClient.setQueryData(["runner-disk", teamId, runnerId], next),
  });
  const size = (bytes: number | null) =>
    bytes === null
      ? "?"
      : bytes >= 1024 ** 3
        ? `${formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${t("GB")}`
        : `${formatNumber(Math.round(bytes / 1024 ** 2))} ${t("MB")}`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 text-2xs text-fg-secondary hover:underline"
      >
        <HardDrive size={12} /> {t("Disk")}
      </button>
    );
  }
  const data = disk.data?.disk;
  const used =
    data?.totalBytes && data.freeBytes !== null ? 1 - data.freeBytes / data.totalBytes : null;
  return (
    <div className="mt-2 rounded border border-border-default p-2 text-xs">
      {disk.isLoading ? (
        <Spinner />
      ) : disk.error ? (
        <p className="text-danger">{vaultErrorMessage(disk.error)}</p>
      ) : data ? (
        <div className="grid gap-1">
          <p className={used !== null && used > 0.85 ? "font-medium text-warning" : ""}>
            <HardDrive size={12} className="mr-1 inline" />
            {size(data.freeBytes)} {t("free of")} {size(data.totalBytes)}
            {used !== null && ` (${Math.round(used * 100)}% used)`}
            {used !== null && used > 0.85 && t(" — builds may run out of space.")}
          </p>
          {(["tools", "cache"] as const).map((what) => (
            <p key={what} className="flex items-center gap-2">
              <span className="w-28">{what === "tools" ? t("Tools (setup)") : t("Caches")}</span>
              <span className="w-16 text-fg-secondary">
                {size(what === "tools" ? data.toolsBytes : data.cacheBytes)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  clear.isPending || (what === "tools" ? data.toolsBytes : data.cacheBytes) === 0
                }
                onClick={async () => {
                  if (
                    await confirmAction({
                      title:
                        what === "tools"
                          ? t("Remove all tools from this machine?")
                          : t("Remove all caches from this machine?"),
                      description: t("The next run fetches them again."),
                      confirmLabel: t("Remove"),
                      danger: true,
                    })
                  ) {
                    clear.mutate(what);
                  }
                }}
              >
                {t("Clear")}
              </Button>
            </p>
          ))}
          {clear.error && <p className="text-danger">{vaultErrorMessage(clear.error)}</p>}
        </div>
      ) : null}
    </div>
  );
}
