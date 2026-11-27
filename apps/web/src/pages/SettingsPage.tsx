import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingField, SettingsGroup } from "@zelyq/core";
import {
  Activity,
  CircleAlert,
  Clapperboard,
  Cpu,
  Gauge,
  GraduationCap,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Lock,
  LockKeyhole,
  Mail,
  Mic,
  Monitor,
  Puzzle,
  RotateCw,
  Server,
  ServerCog,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AdminKeysPanel } from "../components/AdminKeysPanel";
import { AppShell } from "../components/AppShell";
import { CliSessionControl } from "../components/CliSessionControl";
import { FigmaIntegration } from "../components/FigmaIntegration";
import { PlansPanel } from "../components/PlansPanel";
import { SkillUploadControl } from "../components/SkillUploadControl";
import { SupabaseIntegration } from "../components/SupabaseIntegration";
import {
  Badge,
  Button,
  confirmAction,
  IconButton,
  Input,
  NativeSelect,
  PageBody,
  PageHeader,
  Spinner,
  StatusDot,
  toast,
} from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { t, translateServerMessage } from "../lib/i18n";
import { teamHref } from "../lib/routes";

export type Draft = Record<string, string | number | boolean>;

/** The sections, grouped the way an administrator thinks about them. */
const SECTION_GROUPS = [
  t("Models and AI"),
  t("Runtime and preview"),
  t("Identity and access"),
  t("Communication"),
  t("Plans and status"),
  t("Other"),
] as const;
const GROUP_OF: Record<string, (typeof SECTION_GROUPS)[number]> = {
  model: t("Models and AI"),
  "image-generation": t("Models and AI"),
  "video-generation": t("Models and AI"),
  "voice-input": t("Models and AI"),
  ops: t("Models and AI"),
  runtime: t("Runtime and preview"),
  preview: t("Runtime and preview"),
  pipelines: t("Runtime and preview"),
  access: t("Identity and access"),
  users: t("Identity and access"),
  "api-keys": t("Identity and access"),
  email: t("Communication"),
  integrations: t("Communication"),
  plans: t("Plans and status"),
  status: t("Plans and status"),
};

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
  model: { label: t("Model"), icon: Cpu, blurb: t("Which vendor the agent talks to, and its key") },
  "image-generation": {
    label: t("Image generation"),
    icon: ImageIcon,
    blurb: t("Studio image providers, models and limits"),
  },
  "video-generation": {
    label: t("Video generation"),
    icon: Clapperboard,
    blurb: t("Studio video providers, models and limits"),
  },
  "voice-input": {
    label: t("Voice input"),
    icon: Mic,
    blurb: t("Transcription for the microphone"),
  },
  access: { label: t("Access"), icon: LockKeyhole, blurb: t("Who may sign in, and for how long") },
  interface: {
    label: t("Interface"),
    icon: Sparkles,
    blurb: t("What people see around their apps"),
  },
  runtime: { label: t("Runtime"), icon: Server, blurb: t("Where app commands run") },
  pipelines: {
    label: t("Pipelines"),
    icon: Workflow,
    blurb: t("The local runner, and how long runs are kept"),
  },
  preview: { label: t("Preview"), icon: Monitor, blurb: t("How app previews are reached") },
  storage: {
    label: t("Storage"),
    icon: HardDrive,
    blurb: t("Where idle apps sleep: a bucket or a folder"),
  },
  ops: { label: t("Ops"), icon: ServerCog, blurb: t("The model the DevOps engineer thinks with") },
  email: { label: t("Email"), icon: Mail, blurb: t("The mail server Zelyq sends through") },
  integrations: {
    label: t("Integrations"),
    icon: Puzzle,
    blurb: t("Figma and Supabase connections"),
  },
  status: {
    label: t("Instance status"),
    icon: Activity,
    blurb: t("Health, migrations and diagnostics"),
  },
  users: { label: t("Users"), icon: Users, blurb: t("Accounts on this instance") },
  plans: { label: t("Plans"), icon: Gauge, blurb: t("What each team may use") },
  "api-keys": {
    label: t("API keys"),
    icon: KeyRound,
    blurb: t("Keys for your own systems that run this server"),
  },
};

/** A group's name as it arrives from the API, as a section id. */
function sectionId(groupName: string): string {
  if (groupName === "Image Studio") return "image-generation";
  if (groupName === "Video Studio") return "video-generation";
  return groupName.toLowerCase().replace(/\s+/g, "-");
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { user, session } = useSession();
  // Managed: this server is run from the admin; here everything is shown, nothing changes.
  const runFrom = session?.accounts?.name ?? null;
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
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
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
      "pipelines",
      "preview",
      "storage",
    ].filter((id) => fromGroups.includes(id));
    // Anything the server adds later still gets a menu entry rather than
    // silently disappearing from the page.
    const extra = fromGroups.filter((id) => !ordered.includes(id));
    return [...ordered, ...extra, "integrations", "status", "users", "plans", "api-keys"];
  }, [settings.data]);

  const [active, setActive] = useState<string>("model");
  // A deep link picks the section instead of scrolling to it, which is the
  // whole point: `/admin#video-generation` should land on video settings.
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
            ? t("Image generation settings")
            : group.name === "Video Studio"
              ? t("Video generation settings")
              : undefined
        }
        className="mt-7 scroll-mt-6"
      >
        <h2 className="text-sm font-medium text-fg">
          {group.name === "Image Studio"
            ? t("Image generation")
            : group.name === "Video Studio"
              ? t("Video generation")
              : translateServerMessage(group.name)}
        </h2>
        <p className="mt-0.5 text-xs text-fg-secondary">{group.description}</p>
        {group.name === "Video Studio" && (
          <Link
            to={teamHref("/studio/video")}
            className="mt-2 inline-block text-xs text-fg underline underline-offset-4"
          >
            {t("Open Studio — Video")}
          </Link>
        )}
        {group.name === "Image Studio" && (
          <Link
            to={teamHref("/studio/image")}
            className="mt-2 inline-block text-xs text-fg underline underline-offset-4"
          >
            {t("Open Studio — Image")}
          </Link>
        )}

        <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
          {group.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              draft={draft}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  [field.key]: value,
                  // A model belongs to its provider: a new Ops provider starts from its own default.
                  ...(field.key === "opsProvider" ? { opsModel: "" } : {}),
                }))
              }
            />
          ))}
          {group.name === "Model" && (
            <>
              <CliSessionControl
                provider="anthropic"
                onUsed={() => {
                  void queryClient.invalidateQueries({ queryKey: ["settings"] });
                  void queryClient.invalidateQueries({ queryKey: ["providers"] });
                }}
              />
              <CliSessionControl
                provider="openai"
                onUsed={() => {
                  void queryClient.invalidateQueries({ queryKey: ["settings"] });
                  void queryClient.invalidateQueries({ queryKey: ["providers"] });
                }}
              />
            </>
          )}
        </div>
      </section>
    );
  }

  if (settings.isLoading) {
    return (
      <AppShell crumbs={[{ label: t("Server administration") }]} scope="global">
        <div className="grid h-full place-items-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (settings.isError) {
    return (
      <AppShell crumbs={[{ label: t("Server administration") }]} scope="global">
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-sm text-fg">{(settings.error as Error).message}</p>
            <p className="mt-1 text-xs text-fg-secondary">
              {t("Only an instance administrator can change settings.")}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumbs={[{ label: t("Server administration") }]} scope="global">
      <PageBody>
        <PageHeader
          title={t("Server administration")}
          description={t(
            "What runs the whole server, and the defaults every team starts from. Only server admins see this page.",
          )}
        />

        <div className="gap-8 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:items-start">
          {/* The menu. A row that scrolls sideways on a phone, a column
                beside the content on a desktop — the same list either way, so
                there is one idea to learn rather than two. */}
          <nav
            aria-label={t("Settings sections")}
            className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-2 md:sticky md:top-4 md:mx-0 md:mb-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
          >
            {SECTION_GROUPS.map((group) => {
              const ids = sections.filter((id) => (GROUP_OF[id] ?? t("Other")) === group);
              if (ids.length === 0) return null;
              return (
                <div key={group} className="contents md:mb-4 md:block">
                  <p className="hidden px-3 pb-1 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase md:block">
                    {group}
                  </p>
                  {ids.map((id) => {
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
                        onClick={() => {
                          setActive(id);
                          // The address names the section, so it can be shared.
                          window.history.replaceState(null, "", `#${id}`);
                        }}
                        title={meta.blurb}
                        className={`relative flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors md:w-full ${
                          current
                            ? "bg-accent-subtle font-medium text-fg"
                            : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
                        }`}
                      >
                        <Icon
                          size={15}
                          strokeWidth={1.75}
                          className={`shrink-0 ${current ? "text-accent" : ""}`}
                        />
                        <span className="whitespace-nowrap md:whitespace-normal">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <fieldset disabled={Boolean(runFrom)} className="m-0 min-w-0 border-0 p-0">
            {runFrom && (
              <p className="mb-4 rounded-md border border-info/25 bg-info-subtle px-3 py-2 text-xs text-info">
                {t(
                  "This server is connected to {runFrom} and is run from its admin. Everything here is shown as it is set; changes are made in the admin, behind its own sign-in, so nothing that runs the whole server can be changed from inside it.",
                  { runFrom },
                )}
              </p>
            )}
            {settings.data?.restartPending && (
              <p className="mt-5 flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-warning">
                <RotateCw size={14} strokeWidth={1.75} className="mt-px shrink-0" />
                {t("Some changes need the server restarted before they take effect.")}
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

            {active === "email" && <MailTest />}
            {active === "storage" && <StorageTest />}

            {active === "integrations" && (
              <>
                <FigmaIntegration />
                {user?.instanceRole === "admin" && <SupabaseIntegration />}
              </>
            )}

            {active === "status" && (
              <section className="mt-7">
                <h2 className="text-sm font-medium text-fg">{t("Instance status")}</h2>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  {t(
                    "What’s actually running right now — reflects the last restart, not this page.",
                  )}
                </p>

                <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
                  {health.isLoading && (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs text-fg-muted">
                      <Spinner /> {t("Checking…")}
                    </div>
                  )}
                  {health.isError && (
                    <p className="px-4 py-3 text-xs text-danger">
                      {t("Could not reach the server to check status.")}
                    </p>
                  )}
                  {health.data && (
                    <>
                      <StatusRow
                        label={t("Model")}
                        ok={health.data.agent.status === "ok"}
                        detail={
                          health.data.agent.model
                            ? `${health.data.agent.provider ?? health.data.provider} · ${health.data.agent.model}`
                            : t("not configured")
                        }
                      />
                      <StatusRow
                        label={t("Runtime")}
                        ok={health.data.runtime.ok}
                        detail={
                          health.data.runtime.detail ?? (health.data.runtime.ok ? "ok" : "degraded")
                        }
                      />
                      <div className="flex items-start gap-3 px-3 py-3">
                        <Puzzle
                          size={14}
                          strokeWidth={1.75}
                          className="mt-0.5 shrink-0 text-fg-muted"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg">{t("Plugin tools")}</p>
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
                              {t("None loaded. Set {code} and restart the agent — see {link}.", {
                                code: <code className="font-mono">ZELYQ_PLUGIN_DIR</code>,
                                link: (
                                  <a
                                    href="https://github.com/CrowPus/Zelyq/blob/main/docs/plugins.md"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:text-fg"
                                  >
                                    docs/plugins.md
                                  </a>
                                ),
                              })}
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
                          <p className="text-sm text-fg">{t("Skills")}</p>
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
                              {t("None loaded. See {link}.", {
                                link: (
                                  <a
                                    href="https://github.com/CrowPus/Zelyq/blob/main/docs/skills.md"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:text-fg"
                                  >
                                    docs/skills.md
                                  </a>
                                ),
                              })}
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
            )}

            {active === "plans" && <PlansPanel />}
            {active === "api-keys" && <AdminKeysPanel />}

            {active === "users" && (
              <section className="mt-7">
                <h2 className="text-sm font-medium text-fg">{t("Users")}</h2>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  {t("Everyone with an account on this instance, across every team.")}
                </p>

                <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface">
                  {users.isLoading && (
                    <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                      <Spinner /> {t("Loading users…")}
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
                            <span className="ml-1.5 text-xs text-fg-muted">{t("(you)")}</span>
                          )}
                          {account.instanceRole === "admin" && (
                            <span className="ml-1.5 inline-block">
                              <Badge tone="neutral">{t("Server admin")}</Badge>
                            </span>
                          )}
                          {account.twoFactorEnabled && (
                            <span className="ml-1.5 inline-block">
                              <Badge tone="success">{t("Two-factor on")}</Badge>
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-fg-muted">{account.email}</p>
                      </div>
                      <span className="shrink-0 text-2xs text-fg-muted">
                        {t("joined {createdAt}", { createdAt: formatDate(account.createdAt) })}
                      </span>
                      {account.twoFactorEnabled && account.id !== user?.id && (
                        <IconButton
                          size="sm"
                          label={t("Turn off two-factor sign-in for {name}", {
                            name: account.name,
                          })}
                          onClick={async () => {
                            if (
                              await confirmAction({
                                title: t("Turn off two-factor sign-in for {name}?", {
                                  name: account.name,
                                }),
                                description: t(
                                  "For someone who lost both their phone and their recovery codes. They are signed out everywhere and sign in again with their password alone. Check it is really them first.",
                                ),
                                confirmLabel: t("Turn off two-factor"),
                                danger: true,
                                typeToConfirm: account.email,
                              })
                            ) {
                              try {
                                await api.resetUserTwoFactor(account.id);
                                toast.success(
                                  t("Two-factor sign-in is off for {name}", { name: account.name }),
                                );
                                await users.refetch();
                              } catch (failure) {
                                toast.error((failure as Error).message);
                              }
                            }
                          }}
                        >
                          <ShieldOff size={13} strokeWidth={1.75} />
                        </IconButton>
                      )}
                      {account.id !== user?.id && (
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={t("Delete {name}", { name: account.name })}
                          onClick={async () => {
                            if (
                              await confirmAction({
                                title: t("Delete {name} ({email})?", {
                                  name: account.name,
                                  email: account.email,
                                }),
                                description: t(
                                  "This removes their account and anything only they could reach. This cannot be undone.",
                                ),
                                confirmLabel: t("Delete account"),
                                danger: true,
                                typeToConfirm: account.email,
                              })
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
                  {save.isPending ? t("Saving…") : t("Save changes")}
                </Button>
                {dirty && (
                  <Button variant="ghost" onClick={() => setDraft({})}>
                    {t("Discard")}
                  </Button>
                )}
                {saved && (
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <ShieldCheck size={13} strokeWidth={1.75} /> {t("Saved")}
                  </span>
                )}
              </div>
            )}
          </fieldset>
        </div>
      </PageBody>
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

/**
 * A model is picked from the list the key can use; typing a name is there for
 * the rare model the list does not know, behind "Other model…".
 */
function ModelChoice({
  field,
  value,
  providerChanged,
  onChange,
}: {
  field: SettingField;
  value: string;
  providerChanged: boolean;
  onChange(value: string): void;
}) {
  const options = field.modelOptions ?? [];
  const listed = value === "" || options.some((model) => model.value === value);
  const [typing, setTyping] = useState(!listed);
  const other = typing || !listed;
  return (
    <div className="space-y-2">
      <NativeSelect
        aria-label={field.label}
        value={other ? "__other__" : value}
        disabled={providerChanged}
        onChange={(event) => {
          if (event.target.value === "__other__") {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(event.target.value);
        }}
      >
        <option value="">{field.placeholder ?? t("Provider default")}</option>
        {(["recommended", "previous", "legacy"] as const).map((group) => {
          const inGroup = options.filter((model) => (model.group ?? "recommended") === group);
          if (inGroup.length === 0) return null;
          return (
            <optgroup
              key={group}
              label={
                group === "recommended"
                  ? t("Recommended")
                  : group === "previous"
                    ? t("Previous generation")
                    : t("Legacy")
              }
            >
              {inGroup.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                  {model.description ? ` — ${model.description}` : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
        <option value="__other__">{t("Other model…")}</option>
      </NativeSelect>
      {other && !providerChanged && (
        <Input
          aria-label={t("{label}, typed", { label: field.label })}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("The model’s exact name")}
          autoComplete="off"
        />
      )}
      {providerChanged ? (
        <p className="max-w-sm text-xs text-fg-muted">
          {t("Save first; then this lists the models of the provider you chose.")}
        </p>
      ) : (
        field.modelNotice && <p className="max-w-sm text-xs text-fg-muted">{field.modelNotice}</p>
      )}
    </div>
  );
}

export function FieldRow({
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
              title={t("Set by {envVar} in the environment", { envVar: field.envVar })}
            >
              <Lock size={10} strokeWidth={2} />
              {field.envVar}
            </span>
          )}
          {field.restartRequired && <Badge tone="neutral">{t("restart")}</Badge>}
          {field.kind === "secret" && field.configured && !field.vaultName && (
            <Badge tone="success">{field.hint ?? t("set")}</Badge>
          )}
          {field.vaultName && (
            <Badge tone={field.vaultMissing ? "danger" : "info"}>
              {t("Vault: {vaultName}", { vaultName: field.vaultName })}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{field.description}</p>
      </div>

      <div className="sm:justify-self-end">
        {locked ? (
          <p className="font-mono text-xs text-fg-muted">
            {field.kind === "secret" ? (field.hint ?? t("configured")) : String(field.value ?? "")}
          </p>
        ) : field.modelOptions ? (
          <ModelChoice
            field={field}
            value={String(pending ?? field.value ?? "")}
            providerChanged={field.key === "opsModel" && draft.opsProvider !== undefined}
            onChange={onChange}
          />
        ) : field.kind === "select" ? (
          <NativeSelect
            value={String(pending ?? field.value ?? "")}
            onChange={(event) => onChange(event.target.value)}
            aria-label={field.label}
            className="w-full"
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        ) : field.kind === "secret" ? (
          <CredentialInput field={field} pending={pending} onChange={onChange} />
        ) : field.kind === "boolean" ? (
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={Boolean(pending ?? field.value)}
              onChange={(event) => onChange(event.target.checked)}
              className="size-3.5 accent-fg"
            />
            {(pending ?? field.value) ? t("Enabled") : t("Disabled")}
          </label>
        ) : (
          <>
            <Input
              type={field.kind === "number" ? "number" : "text"}
              value={String(pending ?? field.value ?? "")}
              onChange={(event) => onChange(event.target.value)}
              aria-label={field.label}
              autoComplete="off"
              placeholder={field.placeholder}
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

/**
 * A credential: typed here (the default, saved with the page's Save button,
 * encrypted by the server), or taken from the instance Vault. Choosing a
 * Vault secret applies at once — it is a pointer, not a value to review.
 */
function CredentialInput({
  field,
  pending,
  onChange,
}: {
  field: SettingField;
  pending: string | number | boolean | undefined;
  onChange(value: string): void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"typed" | "vault">(field.vaultName ? "vault" : "typed");
  const choices = useQuery({
    queryKey: ["settings-vault-choices"],
    queryFn: () => api.settingsVaultChoices().then((r) => r.groups),
    enabled: mode === "vault",
  });
  const point = useMutation({
    mutationFn: (choice: string) => {
      // Options are "<vault>::<name>"; "" clears the field.
      if (!choice) return api.setCredentialSource(field.key, null);
      const [vault, ...rest] = choice.split("::");
      return api.setCredentialSource(field.key, rest.join("::"), vault);
    },
    onSuccess: (next) => queryClient.setQueryData(["settings"], next),
  });
  const current = field.vaultName ? `${field.vaultScope ?? "instance"}::${field.vaultName}` : "";
  const anyChoices = choices.data?.some((group) => group.names.length > 0);
  return (
    <div className="grid gap-1.5 sm:w-[260px]">
      <fieldset className="flex gap-0.5 rounded-md border border-border-default bg-surface-subtle p-0.5 text-xs">
        <legend className="sr-only">{t("Where {label} comes from", { label: field.label })}</legend>
        {(
          [
            ["typed", t("Type a value")],
            ["vault", t("From Vault")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`h-6 flex-1 rounded px-2 ${
              mode === id ? "bg-surface text-fg shadow-sm" : "text-fg-secondary hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {mode === "typed" ? (
        <Input
          type="password"
          value={String(pending ?? "")}
          onChange={(event) => onChange(event.target.value)}
          aria-label={field.label}
          autoComplete="new-password"
          placeholder={
            field.vaultName
              ? t("Type a value to use instead of Vault")
              : field.configured
                ? t("Enter a new value to replace")
                : field.placeholder
          }
        />
      ) : (
        <>
          <NativeSelect
            aria-label={t("{label} from Vault", { label: field.label })}
            className="w-full font-mono"
            value={current}
            disabled={point.isPending}
            onChange={(event) => point.mutate(event.target.value)}
          >
            <option value="">{choices.isPending ? t("Loading…") : t("Choose a secret…")}</option>
            {choices.data
              ?.filter((group) => group.names.length > 0)
              .map((group) => (
                <optgroup key={group.scope} label={group.label}>
                  {group.names.map((name) => (
                    <option key={`${group.scope}::${name}`} value={`${group.scope}::${name}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))}
            {field.vaultName &&
              !choices.data?.some(
                (group) =>
                  group.scope === (field.vaultScope ?? "instance") &&
                  group.names.includes(field.vaultName ?? ""),
              ) && (
                <option value={current}>
                  {t("{vaultName} (missing)", { vaultName: field.vaultName })}
                </option>
              )}
          </NativeSelect>
          {choices.data && !anyChoices && (
            <p className="text-2xs text-fg-muted">
              {t("Your Vault is empty. {link} first.", {
                link: (
                  <Link to={teamHref("/vault")} className="underline underline-offset-2">
                    {t("Add a key in Vault")}
                  </Link>
                ),
              })}
            </p>
          )}
        </>
      )}
      {field.vaultMissing && (
        <p role="alert" className="text-2xs text-danger">
          {t("{vaultName} is no longer in Vault, so this key is not set.", {
            vaultName: field.vaultName,
          })}
        </p>
      )}
      {point.isError && (
        <p role="alert" className="text-2xs text-danger">
          {point.error instanceof Error ? point.error.message : t("Could not change it.")}
        </p>
      )}
    </div>
  );
}

/** Settings → Storage: proves the saved storage works by writing, reading and deleting a small file. */
function StorageTest() {
  const test = useMutation({ mutationFn: () => api.testStorage() });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? <Spinner /> : <HardDrive size={14} strokeWidth={1.75} />}
        {t("Test storage")}
      </Button>
      {test.isSuccess && (
        <span className="text-success">
          {t("Works: Zelyq wrote, read and deleted a test file in {where}.", {
            where: test.data.where,
          })}
        </span>
      )}
      {test.isError && <span className="text-danger">{(test.error as Error).message}</span>}
      {!test.isSuccess && !test.isError && (
        <span className="text-fg-muted">{t("Save the settings first, then test them.")}</span>
      )}
    </div>
  );
}

/** Settings → Email: proves the saved settings work by sending the admin a message. */
function MailTest() {
  const test = useMutation({ mutationFn: () => api.testMail() });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? <Spinner /> : <Mail size={14} strokeWidth={1.75} />}
        {t("Send a test email")}
      </Button>
      {test.isSuccess && (
        <span className="text-success">
          {t("Sent to {to}. Check that it arrived.", { to: test.data.to })}
        </span>
      )}
      {test.isError && <span className="text-danger">{(test.error as Error).message}</span>}
      {!test.isSuccess && !test.isError && (
        <span className="text-fg-muted">
          {t("Save the settings first, then send yourself a test.")}
        </span>
      )}
    </div>
  );
}
