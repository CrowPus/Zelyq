import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingField, SettingsGroup } from "@zelyq/core";
import {
  Activity,
  CircleAlert,
  Clapperboard,
  Cpu,
  GraduationCap,
  Image as ImageIcon,
  Lock,
  LockKeyhole,
  Mic,
  Monitor,
  Puzzle,
  RotateCw,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CliSessionControl } from "../components/CliSessionControl";
import { FigmaIntegration } from "../components/FigmaIntegration";
import { SkillUploadControl } from "../components/SkillUploadControl";
import { SupabaseIntegration } from "../components/SupabaseIntegration";
import { Badge, Button, IconButton, Input, Spinner, StatusDot } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

type Draft = Record<string, string | number | boolean>;

/**
 * Everything that can be set through the environment can be set here instead,
 * for people who will never open a terminal. The environment still wins: a
 * field it supplies is shown locked, naming the variable, rather than pretending
 * to be editable.
 */
/**
 * Settings used to be one long column: every group stacked, so finding the
 * video keys meant scrolling past sixteen model fields. A menu makes the shape
 * of the page visible and puts every section one click away instead.
 *
 * Ids are the same strings the deep links already used (`#image-generation`,
 * `#video-generation`), so links from Studio keep working — they now select a
 * section rather than scrolling to one.
 */
const SECTION_META: Record<string, { label: string; icon: typeof Cpu; blurb: string }> = {
  model: { label: "Model", icon: Cpu, blurb: "Which vendor the agent talks to, and its key" },
  "image-generation": {
    label: "Image generation",
    icon: ImageIcon,
    blurb: "Image Studio providers, models and limits",
  },
  "video-generation": {
    label: "Video generation",
    icon: Clapperboard,
    blurb: "Video Studio providers, models and limits",
  },
  "voice-input": { label: "Voice input", icon: Mic, blurb: "Transcription for the microphone" },
  access: { label: "Access", icon: LockKeyhole, blurb: "Who may sign in, and for how long" },
  runtime: { label: "Runtime", icon: Server, blurb: "Where project commands run" },
  preview: { label: "Preview", icon: Monitor, blurb: "How project previews are reached" },
  integrations: {
    label: "Integrations",
    icon: Puzzle,
    blurb: "Figma and Supabase connections",
  },
  status: { label: "Instance status", icon: Activity, blurb: "Health, migrations and diagnostics" },
  users: { label: "Users", icon: Users, blurb: "Accounts on this instance" },
};

/** A group's name as it arrives from the API, as a section id. */
function sectionId(groupName: string): string {
  if (groupName === "Image Studio") return "image-generation";
  if (groupName === "Video Studio") return "video-generation";
  return groupName.toLowerCase().replace(/\s+/g, "-");
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { hash } = useLocation();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (caught) => setError((caught as Error).message),
  });

  const save = useMutation({
    mutationFn: () => api.updateSettings(draft),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      void queryClient.invalidateQueries({ queryKey: ["image-capabilities"] });
      void queryClient.invalidateQueries({ queryKey: ["video-capabilities"] });
      setDraft({});
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const dirty = Object.keys(draft).length > 0;

  /** Every section this instance actually has, in menu order: the configured
   *  groups first, then the two that are not settings at all. */
  const sections = useMemo(() => {
    const fromGroups = (settings.data?.groups ?? []).map((group) => sectionId(group.name));
    const ordered = [
      "model",
      "image-generation",
      "video-generation",
      "voice-input",
      "access",
      "runtime",
      "preview",
    ].filter((id) => fromGroups.includes(id));
    // Anything the server adds later still gets a menu entry rather than
    // silently disappearing from the page.
    const extra = fromGroups.filter((id) => !ordered.includes(id));
    return [...ordered, ...extra, "integrations", "status", "users"];
  }, [settings.data]);

  const [active, setActive] = useState<string>("model");
  // A deep link picks the section instead of scrolling to it, which is the
  // whole point: `/settings#video-generation` should land on video settings.
  //
  // The fallback waits for the data. Before it arrives there are no groups, so
  // the section list is just the three static ones — and "correct an unknown
  // section" would land the page on Integrations every time.
  // Applied once per hash. Re-applying it on every render would pin the page
  // to the deep-linked section: clicking any other menu item snapped straight
  // back, because the URL still said `#video-generation`.
  const appliedHash = useRef<string | null>(null);
  useEffect(() => {
    const wanted = hash.slice(1);
    if (wanted && sections.includes(wanted) && appliedHash.current !== hash) {
      appliedHash.current = hash;
      setActive(wanted);
      return;
    }
    if (settings.data && !sections.includes(active) && sections.length)
      setActive(sections[0] as string);
  }, [hash, sections, active, settings.data]);

  /** Sections that hold editable settings. Integrations, status and users have
   *  their own controls, so a global "Save changes" under them is noise. */
  const editable = (settings.data?.groups ?? []).some((group) => sectionId(group.name) === active);

  function renderGroup(group: SettingsGroup) {
    return (
      <section
        key={group.name}
        id={
          group.name === "Image Studio"
            ? "image-generation"
            : group.name === "Video Studio"
              ? "video-generation"
              : undefined
        }
        aria-label={
          group.name === "Image Studio"
            ? "Image generation settings"
            : group.name === "Video Studio"
              ? "Video generation settings"
              : undefined
        }
        className="mt-7 scroll-mt-6"
      >
        <h2 className="text-sm font-medium text-fg">
          {group.name === "Image Studio" ? "Image generation" : group.name}
        </h2>
        <p className="mt-0.5 text-xs text-fg-secondary">{group.description}</p>
        {group.name === "Video Studio" && (
          <Link
            to="/video-studio"
            className="mt-2 inline-block text-xs text-fg underline underline-offset-4"
          >
            Open Video Studio
          </Link>
        )}
        {group.name === "Image Studio" && (
          <Link
            to="/image-studio"
            className="mt-2 inline-block text-xs text-fg underline underline-offset-4"
          >
            Open Image Studio
          </Link>
        )}

        <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
          {group.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              draft={draft}
              onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
            />
          ))}
          {group.name === "Model" && (
            <>
              <CliSessionControl
                provider="anthropic"
                onUsed={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
              />
              <CliSessionControl
                provider="openai"
                onUsed={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}
              />
            </>
          )}
        </div>
        {["Image Studio", "Video Studio"].includes(group.name) && (
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            {saved && (
              <span role="status" className="text-xs text-success">
                Saved
              </span>
            )}
          </div>
        )}
      </section>
    );
  }

  if (settings.isLoading) {
    return (
      <AppShell crumbs={[{ label: "Settings" }]}>
        <div className="grid h-full place-items-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (settings.isError) {
    return (
      <AppShell crumbs={[{ label: "Settings" }]}>
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-sm text-fg">{(settings.error as Error).message}</p>
            <p className="mt-1 text-xs text-fg-secondary">
              Only an instance administrator can change settings.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumbs={[{ label: "Settings" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <header>
            <h1 className="text-xl font-semibold text-fg">Settings</h1>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
              These can also be set as environment variables. Anything the environment provides is
              shown locked here, because the environment takes precedence.
            </p>
          </header>

          <div className="mt-6 gap-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
            {/* The menu. A row that scrolls sideways on a phone, a column
                beside the content on a desktop — the same list either way, so
                there is one idea to learn rather than two. */}
            <nav
              aria-label="Settings sections"
              className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-2 md:sticky md:top-4 md:mx-0 md:mb-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
            >
              {sections.map((id) => {
                const meta = SECTION_META[id] ?? {
                  label: id.replace(/-/g, " "),
                  icon: Puzzle,
                  blurb: "",
                };
                const Icon = meta.icon;
                const current = active === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    onClick={() => setActive(id)}
                    title={meta.blurb}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors md:w-full ${
                      current
                        ? "bg-surface-hover font-medium text-fg"
                        : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <Icon size={14} strokeWidth={1.75} className="shrink-0" />
                    <span className="whitespace-nowrap md:whitespace-normal">{meta.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0">
              {settings.data?.restartPending && (
                <p className="mt-5 flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-warning">
                  <RotateCw size={14} strokeWidth={1.75} className="mt-px shrink-0" />
                  Some changes need the server restarted before they take effect.
                </p>
              )}

              {active === "image-generation" &&
                settings.data?.groups.filter((g) => g.name === "Image Studio").map(renderGroup)}
              {active === "video-generation" &&
                settings.data?.groups.filter((g) => g.name === "Video Studio").map(renderGroup)}
              {settings.data?.groups
                .filter((g) => !["Image Studio", "Video Studio"].includes(g.name))
                .filter((g) => sectionId(g.name) === active)
                .map(renderGroup)}

              {active === "integrations" && (
                <>
                  <FigmaIntegration />
                  {user?.instanceRole === "admin" && <SupabaseIntegration />}
                </>
              )}

              {active === "status" && (
                <>
                  <section className="mt-7">
                    <h2 className="text-sm font-medium text-fg">Instance status</h2>
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      What's actually running right now — reflects the last restart, not this page.
                    </p>

                    <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
                      {health.isLoading && (
                        <div className="flex items-center gap-2 px-4 py-3 text-xs text-fg-muted">
                          <Spinner /> Checking…
                        </div>
                      )}
                      {health.isError && (
                        <p className="px-4 py-3 text-xs text-danger">
                          Could not reach the server to check status.
                        </p>
                      )}
                      {health.data && (
                        <>
                          <StatusRow
                            label="Model"
                            ok={health.data.agent.status === "ok"}
                            detail={
                              health.data.agent.model
                                ? `${health.data.agent.provider ?? health.data.provider} · ${health.data.agent.model}`
                                : "not configured"
                            }
                          />
                          <StatusRow
                            label="Runtime"
                            ok={health.data.runtime.ok}
                            detail={
                              health.data.runtime.detail ??
                              (health.data.runtime.ok ? "ok" : "degraded")
                            }
                          />
                          <div className="flex items-start gap-3 px-3 py-3">
                            <Puzzle
                              size={14}
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-fg-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-fg">Plugin tools</p>
                              {health.data.agent.plugins?.length ? (
                                <p className="mt-0.5 flex flex-wrap gap-1.5">
                                  {health.data.agent.plugins.map((name) => (
                                    <Badge key={name} tone="success">
                                      {name}
                                    </Badge>
                                  ))}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-xs text-fg-secondary">
                                  None loaded. Set{" "}
                                  <code className="font-mono">ZELYQ_PLUGIN_DIR</code> and restart
                                  the agent — see{" "}
                                  <a
                                    href="https://github.com/CrowPus/Zelyq/blob/main/docs/plugins.md"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:text-fg"
                                  >
                                    docs/plugins.md
                                  </a>
                                  .
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-start gap-3 px-3 py-3">
                            <GraduationCap
                              size={14}
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-fg-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-fg">Skills</p>
                              {health.data.agent.skills?.length ? (
                                <p className="mt-0.5 flex flex-wrap gap-1.5">
                                  {health.data.agent.skills.map((skill) => (
                                    <span key={skill.name} title={skill.description}>
                                      <Badge tone="success">{skill.name}</Badge>
                                    </span>
                                  ))}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-xs text-fg-secondary">
                                  None loaded. See{" "}
                                  <a
                                    href="https://github.com/CrowPus/Zelyq/blob/main/docs/skills.md"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:text-fg"
                                  >
                                    docs/skills.md
                                  </a>
                                  .
                                </p>
                              )}
                              <div className="mt-2">
                                <SkillUploadControl />
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                </>
              )}

              {active === "users" && (
                <>
                  <section className="mt-7">
                    <h2 className="text-sm font-medium text-fg">Users</h2>
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      Everyone with an account on this instance, across every team.
                    </p>

                    <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface">
                      {users.isLoading && (
                        <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                          <Spinner /> Loading users…
                        </div>
                      )}
                      {users.data?.users.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-fg">
                              {account.name}
                              {account.id === user?.id && (
                                <span className="ml-1.5 text-xs text-fg-muted">(you)</span>
                              )}
                              {account.instanceRole === "admin" && (
                                <span className="ml-1.5 inline-block">
                                  <Badge tone="neutral">instance admin</Badge>
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-2xs text-fg-muted">
                              {account.email}
                            </p>
                          </div>
                          <span className="shrink-0 text-2xs text-fg-muted">
                            joined {new Date(account.createdAt).toLocaleDateString()}
                          </span>
                          {account.id !== user?.id && (
                            <IconButton
                              size="sm"
                              variant="danger"
                              label={`Delete ${account.name}`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${account.name} (${account.email})? This removes their account and anything only they could reach. This cannot be undone.`,
                                  )
                                ) {
                                  deleteUser.mutate(account.id);
                                }
                              }}
                            >
                              <Trash2 size={13} strokeWidth={1.75} />
                            </IconButton>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {error && (
                <p className="mt-5 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
                  <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
                  {error}
                </p>
              )}

              {editable && (
                <div className="mt-6 flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={() => save.mutate()}
                    disabled={!dirty || save.isPending}
                  >
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                  {dirty && (
                    <Button variant="ghost" onClick={() => setDraft({})}>
                      Discard
                    </Button>
                  )}
                  {saved && (
                    <span className="flex items-center gap-1.5 text-xs text-success">
                      <ShieldCheck size={13} strokeWidth={1.75} /> Saved
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <StatusDot tone={ok ? "success" : "danger"} />
      <span className="w-20 shrink-0 text-sm text-fg">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">{detail}</span>
    </div>
  );
}

function FieldRow({
  field,
  draft,
  onChange,
}: {
  field: SettingField;
  draft: Draft;
  onChange(value: string | number | boolean): void;
}) {
  const pending = draft[field.key];
  const locked = field.managedByEnv;

  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg">{field.label}</span>
          {locked && (
            <span
              className="inline-flex items-center gap-1 text-2xs text-fg-muted"
              title={`Set by ${field.envVar} in the environment`}
            >
              <Lock size={10} strokeWidth={2} />
              {field.envVar}
            </span>
          )}
          {field.restartRequired && <Badge tone="neutral">restart</Badge>}
          {field.kind === "secret" && field.configured && (
            <Badge tone="success">{field.hint ?? "set"}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{field.description}</p>
      </div>

      <div className="sm:justify-self-end">
        {locked ? (
          <p className="font-mono text-xs text-fg-muted">
            {field.kind === "secret" ? (field.hint ?? "configured") : String(field.value ?? "")}
          </p>
        ) : field.kind === "select" ? (
          <select
            value={String(pending ?? field.value ?? "")}
            onChange={(event) => onChange(event.target.value)}
            aria-label={field.label}
            className="h-[30px] w-full rounded-md border border-border-default bg-surface px-2 text-sm text-fg"
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.kind === "boolean" ? (
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={Boolean(pending ?? field.value)}
              onChange={(event) => onChange(event.target.checked)}
              className="size-3.5 accent-fg"
            />
            {(pending ?? field.value) ? "Enabled" : "Disabled"}
          </label>
        ) : (
          <>
            <Input
              type={
                field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text"
              }
              value={String(pending ?? (field.kind === "secret" ? "" : (field.value ?? "")))}
              onChange={(event) => onChange(event.target.value)}
              aria-label={field.label}
              autoComplete={field.kind === "secret" ? "new-password" : "off"}
              placeholder={
                field.kind === "secret" && field.configured
                  ? "Enter a new value to replace"
                  : field.placeholder
              }
              list={field.suggestions ? `${field.key}-suggestions` : undefined}
            />
            {field.suggestions && (
              <datalist id={`${field.key}-suggestions`}>
                {field.suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
    </div>
  );
}
