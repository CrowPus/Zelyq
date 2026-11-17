import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast, type SettingsGroup } from "@zelyq/core";
import {
  Bot,
  CircleAlert,
  Cpu,
  Film,
  Gauge,
  Image,
  KeyRound,
  LifeBuoy,
  Mail,
  Mic,
  Puzzle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { SupportAccessPanel } from "../components/SupportAccessPanel";
import { TeamIntegrations } from "../components/TeamIntegrations";
import { TeamKeys } from "../components/TeamKeys";
import { TeamMailPanel } from "../components/TeamMailPanel";
import { UsagePanel } from "../components/UsagePanel";
import { Badge, Button, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { type Draft, FieldRow } from "./SettingsPage";

/** What each group is called on a team's page. */
const GROUP_WORDS: Record<string, { title: string; description: string }> = {
  Model: {
    title: "Building apps",
    description: "Which AI builds this team's apps, and how hard it thinks.",
  },
  "Image Studio": {
    title: "Image Studio",
    description: "Which provider and model make this team's images.",
  },
  "Video Studio": {
    title: "Video Studio",
    description: "Which provider and model make this team's videos.",
  },
  "Voice input": {
    title: "Voice input",
    description: "How this team's spoken words become text.",
  },
  Ops: {
    title: "Ops",
    description: "The AI behind this team's DevOps engineer, and the voice it speaks with.",
  },
};

/** The menu: each section with its icon. Setting groups get theirs by name. */
const SECTIONS: Record<string, { label: string; icon: typeof Cpu }> = {
  plan: { label: "Usage and plan", icon: Gauge },
  "ai-keys": { label: "AI keys", icon: KeyRound },
  Model: { label: "Building apps", icon: Cpu },
  "Image Studio": { label: "Image Studio", icon: Image },
  "Video Studio": { label: "Video Studio", icon: Film },
  "Voice input": { label: "Voice input", icon: Mic },
  Ops: { label: "Ops", icon: Bot },
  email: { label: "Email", icon: Mail },
  integrations: { label: "Integrations", icon: Puzzle },
  support: { label: "Support access", icon: LifeBuoy },
};

/** The sections that are not setting groups: each has its own panel. */
const PANELS = ["plan", "ai-keys", "email", "integrations", "support"];

/** A section's address in the page link (#building-apps). */
function slug(id: string): string {
  return (SECTIONS[id]?.label ?? id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Building apps first, then Studio, voice and Ops. */
function groupOrder(name: string): number {
  const at = Object.keys(GROUP_WORDS).indexOf(name);
  return at === -1 ? 99 : at;
}

/**
 * Everything a team decides for itself: its AI keys, how its apps are built,
 * Studio, voice and Ops. Its admins have full control; anything not chosen
 * uses the server's default. What runs the server itself stays with the
 * server's administrator.
 */
export function TeamSettingsPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { teams } = useSession();
  const team = teams.find((candidate) => candidate.id === id);
  const canManage = team ? roleAtLeast(team.role, "admin") : false;
  const settings = useQuery({
    queryKey: ["team-settings", id],
    queryFn: () => api.teamSettings(id),
    enabled: Boolean(id),
  });
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updateTeamSettings(id, draft),
    onSuccess: (next) => {
      queryClient.setQueryData(["team-settings", id], next);
      // What the team's apps, Studio and model picker use changed.
      for (const key of ["providers", "image-capabilities", "video-capabilities"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setDraft({});
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (caught) => setError((caught as Error).message),
  });
  const dirty = Object.keys(draft).length > 0;

  // One section at a time, picked from the menu (like Server settings), so
  // nothing needs scrolling to. The page link names it: /teams/:id/settings#email.
  const groups = useMemo(
    () =>
      [...(settings.data?.groups ?? [])].sort((a, b) => groupOrder(a.name) - groupOrder(b.name)),
    [settings.data],
  );
  const sections = useMemo(
    () => [
      "plan",
      "ai-keys",
      ...groups.map((group) => group.name),
      "email",
      "integrations",
      "support",
    ],
    [groups],
  );
  const { hash } = useLocation();
  const [active, setActive] = useState("plan");
  const appliedHash = useRef<string | null>(null);
  useEffect(() => {
    const wanted = sections.find((id) => slug(id) === hash.slice(1));
    if (wanted && appliedHash.current !== hash) {
      appliedHash.current = hash;
      setActive(wanted);
    }
  }, [hash, sections]);
  // On a phone the menu is a row that scrolls sideways: keep the chosen one in
  // sight, again when the menu grows (the team's setting groups arrive later).
  useEffect(() => {
    if (!sections.includes(active)) return;
    document
      .querySelector(`nav[aria-label="Team settings sections"] [data-section="${slug(active)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, sections]);
  function open(id: string) {
    setActive(id);
    window.history.replaceState(window.history.state, "", `#${slug(id)}`);
  }
  const activeGroup = groups.find((group) => group.name === active);

  function renderGroup(group: SettingsGroup) {
    const words = GROUP_WORDS[group.name] ?? { title: group.name, description: group.description };
    return (
      <section key={group.name} className="mt-7">
        <h2 className="text-sm font-medium text-fg">{words.title}</h2>
        <p className="mt-0.5 text-xs text-fg-secondary">{words.description}</p>
        <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
          {group.fields.map((field) => {
            const reset = draft[field.key] === "";
            const teamChoice = field.source === "database" && !reset;
            return (
              <div key={field.key}>
                <fieldset disabled={!canManage} className="disabled:opacity-80">
                  <FieldRow
                    field={field}
                    draft={draft}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        [field.key]: value,
                        // A model belongs to its provider: a new provider starts on its own default.
                        ...(field.key === "provider" ? { model: "" } : {}),
                        ...(field.key === "opsProvider" ? { opsModel: "" } : {}),
                      }))
                    }
                  />
                </fieldset>
                <div className="flex items-center gap-2 px-3 pb-2.5 text-2xs text-fg-muted">
                  {teamChoice ? (
                    <Badge tone="info">Team's choice</Badge>
                  ) : (
                    <span>
                      {reset
                        ? "Goes back to the server's default when you save"
                        : "Server's default"}
                    </span>
                  )}
                  {canManage && teamChoice && (
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-fg"
                      onClick={() => setDraft((current) => ({ ...current, [field.key]: "" }))}
                    >
                      Use the server's default
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <AppShell
      crumbs={[
        { label: "Teams", to: "/" },
        { label: team?.name ?? "Team", to: `/teams/${id}` },
        { label: "Settings" },
      ]}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 pb-28 sm:px-6 sm:py-8">
          <header>
            <h1 className="text-xl font-semibold text-fg">{team?.name ?? "Team"} settings</h1>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
              Everything this team decides for itself: its plan, AI keys, how its apps are built,
              Studio, voice, Ops, its own email and its integrations.{" "}
              {canManage ? "As a team admin you" : "A team admin"} can change all of it; anything
              left alone uses the server's default. Members, Ops access and alerts are on the{" "}
              <Link to={`/teams/${id}`} className="underline underline-offset-2">
                team page
              </Link>{" "}
              and the{" "}
              <Link to="/ops" className="underline underline-offset-2">
                Ops page
              </Link>
              .
            </p>
          </header>

          <div className="mt-6 gap-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
            {/* The menu: a row that scrolls sideways on a phone, a column on a desktop. */}
            <nav
              aria-label="Team settings sections"
              className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-2 md:sticky md:top-4 md:mx-0 md:mb-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
            >
              {sections.map((section) => {
                const meta = SECTIONS[section] ?? { label: section, icon: Puzzle };
                const Icon = meta.icon;
                const current = active === section;
                return (
                  <button
                    key={section}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    data-section={slug(section)}
                    onClick={() => open(section)}
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

            <div className="min-w-0 [&>section:first-child]:mt-0">
              {active === "plan" && (
                <UsagePanel teamId={id} canEdit={team ? roleAtLeast(team.role, "editor") : false} />
              )}
              {active === "ai-keys" && <TeamKeys teamId={id} canManage={canManage} />}
              {active === "email" && <TeamMailPanel teamId={id} canManage={canManage} />}
              {active === "integrations" && <TeamIntegrations teamId={id} canManage={canManage} />}
              {active === "support" && <SupportAccessPanel teamId={id} canManage={canManage} />}
              {activeGroup && renderGroup(activeGroup)}
              {!activeGroup && settings.isLoading && !PANELS.includes(active) && (
                <div className="mt-8 grid place-items-center">
                  <Spinner />
                </div>
              )}
              {settings.isError && (
                <p className="mt-6 text-sm text-danger">{(settings.error as Error).message}</p>
              )}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger"
            >
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>
      {canManage && (dirty || saved) && (
        <div className="fixed right-4 bottom-4 left-4 z-40 mx-auto flex max-w-5xl items-center justify-end gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 shadow-lg">
          {saved && !dirty ? (
            <span className="text-xs text-success">Saved.</span>
          ) : (
            <>
              <span className="mr-auto text-xs text-fg-secondary">Unsaved changes</span>
              <Button size="sm" variant="ghost" onClick={() => setDraft({})}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
