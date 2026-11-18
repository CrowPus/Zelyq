import * as RadixDialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Command } from "cmdk";
import {
  ArrowRight,
  BookOpen,
  Bot,
  House,
  Keyboard,
  KeyRound,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Plus,
  Rocket,
  Search,
  ServerCog,
  Shield,
  SlidersHorizontal,
  Sun,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { useTheme } from "../hooks/useTheme";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { globalPaths, teamKey, teamPaths, useTeamPaths } from "../lib/routes";
import { isMac } from "./AppShell";
import { setPaletteOpen as setOpen, usePaletteOpen as useOpen } from "./command-palette-store";
import { Avatar, Dialog, Kbd } from "./ui";

/**
 * ⌘K / Ctrl K: jump to any app, pipeline, environment, team or settings
 * section, or run an action, without touching the mouse.
 */
export function CommandPalette() {
  const { user } = useSession();
  return user ? <Palette_ /> : null;
}

function Palette_() {
  const open = useOpen();
  const navigate = useNavigate();
  const { team, teams } = useActiveTeam();
  const { user, signOut } = useSession();
  const { setTheme } = useTheme();
  const p = useTeamPaths();
  const [search, setSearch] = useState("");
  const teamId = team?.id ?? "";
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;

  const enabled = open === "palette" && Boolean(user);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled,
    staleTime: 30_000,
  });
  const pipelines = useQuery({
    queryKey: ["pipelines", teamId],
    queryFn: () => api.pipelines.list(teamId),
    enabled: enabled && Boolean(teamId),
    staleTime: 30_000,
    retry: false,
  });
  const environments = useQuery({
    queryKey: ["environments", teamId],
    queryFn: () => api.deploys.environments(teamId),
    enabled: enabled && Boolean(teamId),
    staleTime: 30_000,
    retry: false,
  });

  function run(action: () => void) {
    setOpen("none");
    setSearch("");
    action();
  }

  const apps = (projects.data?.projects ?? []).filter((project) => project.teamId === teamId);

  return (
    <>
      <RadixDialog.Root
        open={open === "palette"}
        onOpenChange={(next) => {
          setOpen(next ? "palette" : "none");
          if (!next) setSearch("");
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--backdrop)] data-[state=open]:animate-[ui-fade-in_120ms_ease-out]" />
          <RadixDialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-default bg-overlay shadow-dialog focus:outline-none data-[state=open]:animate-[ui-dialog-in_160ms_cubic-bezier(0.16,1,0.3,1)]">
            <RadixDialog.Title className="sr-only">{t("Search and commands")}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              {t("Type to find an app, a page or an action.")}
            </RadixDialog.Description>
            <Command label={t("Search and commands")} loop>
              <div className="flex items-center gap-2 border-b border-border-default px-4">
                <Search size={16} className="shrink-0 text-fg-muted" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder={t("Search apps, pages and actions…")}
                  className="h-12 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted"
                />
                <Kbd>{t("Esc")}</Kbd>
              </div>
              <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">
                  {t("Nothing matches “{search}”.", { search })}
                </Command.Empty>

                {apps.length > 0 && (
                  <Group heading={t("Apps")}>
                    {apps.slice(0, search ? 50 : 6).map((project) => (
                      <Item
                        key={project.id}
                        value={`app ${project.name} ${project.id}`}
                        icon={<Avatar name={project.name} size={18} shape="square" />}
                        onSelect={() => run(() => navigate(p.app(project.id)))}
                        hint={t("App")}
                      >
                        {project.name}
                      </Item>
                    ))}
                  </Group>
                )}

                <Group heading={t("Go to")}>
                  <Item
                    value="go home"
                    icon={<House size={15} />}
                    onSelect={() => run(() => navigate(p.home))}
                  >
                    {t("Home")}
                  </Item>
                  <Item
                    value="go apps"
                    icon={<LayoutGrid size={15} />}
                    onSelect={() => run(() => navigate(p.apps))}
                  >
                    {t("Apps")}
                  </Item>
                  <Item
                    value="go studio image video"
                    icon={<Palette size={15} />}
                    onSelect={() => run(() => navigate(p.studioImage))}
                  >
                    {t("Studio")}
                  </Item>
                  <Item
                    value="go agents mcp"
                    icon={<Bot size={15} />}
                    onSelect={() => run(() => navigate(p.agents))}
                  >
                    {t("Agents")}
                  </Item>
                  <Item
                    value="go pipelines ci"
                    icon={<Workflow size={15} />}
                    onSelect={() => run(() => navigate(p.pipelines))}
                  >
                    {t("Pipelines")}
                  </Item>
                  <Item
                    value="go deployments environments"
                    icon={<Rocket size={15} />}
                    onSelect={() => run(() => navigate(p.deployments))}
                  >
                    {t("Deployments")}
                  </Item>
                  <Item
                    value="go ops devops"
                    icon={<ServerCog size={15} />}
                    onSelect={() => run(() => navigate(p.ops))}
                  >
                    {t("Ops")}
                  </Item>
                  <Item
                    value="go vault secrets keys"
                    icon={<KeyRound size={15} />}
                    onSelect={() => run(() => navigate(p.vault))}
                  >
                    {t("Vault")}
                  </Item>
                  <Item
                    value="go members team people invite"
                    icon={<Users size={15} />}
                    onSelect={() => run(() => navigate(p.members))}
                  >
                    {t("Members")}
                  </Item>
                  {isAdmin && (
                    <Item
                      value="go team settings"
                      icon={<SlidersHorizontal size={15} />}
                      onSelect={() => run(() => navigate(p.settings()))}
                    >
                      {t("Team settings")}
                    </Item>
                  )}
                  <Item
                    value="go account profile password"
                    icon={<UserRound size={15} />}
                    onSelect={() => run(() => navigate(globalPaths.account))}
                  >
                    {t("Account settings")}
                  </Item>
                  {user?.instanceRole === "admin" && (
                    <Item
                      value="go server administration admin settings"
                      icon={<Shield size={15} />}
                      onSelect={() => run(() => navigate(globalPaths.admin()))}
                    >
                      {t("Server administration")}
                    </Item>
                  )}
                  <Item
                    value="go docs documentation guide help"
                    icon={<BookOpen size={15} />}
                    onSelect={() => run(() => navigate(globalPaths.docs))}
                  >
                    {t("Documentation")}
                  </Item>
                </Group>

                {search && (pipelines.data?.pipelines.length ?? 0) > 0 && (
                  <Group heading={t("Pipelines")}>
                    {pipelines.data!.pipelines.map((pipeline) => (
                      <Item
                        key={pipeline.id}
                        value={`pipeline ${pipeline.name}`}
                        icon={<Workflow size={15} />}
                        onSelect={() => run(() => navigate(p.pipeline(pipeline.id)))}
                        hint={t("Pipeline")}
                      >
                        {pipeline.name}
                      </Item>
                    ))}
                  </Group>
                )}

                {search && (environments.data?.environments.length ?? 0) > 0 && (
                  <Group heading={t("Environments")}>
                    {environments.data!.environments.map((env) => (
                      <Item
                        key={env.id}
                        value={`environment ${env.name}`}
                        icon={<Rocket size={15} />}
                        onSelect={() => run(() => navigate(p.deployments))}
                        hint={t("Environment")}
                      >
                        {env.name}
                      </Item>
                    ))}
                  </Group>
                )}

                <Group heading={t("Actions")}>
                  <Item
                    value="new app create"
                    icon={<Plus size={15} />}
                    onSelect={() => run(() => navigate(p.newApp))}
                  >
                    {t("New app")}
                  </Item>
                  <Item
                    value="new pipeline create"
                    icon={<Plus size={15} />}
                    onSelect={() => run(() => navigate(p.pipeline("new")))}
                  >
                    {t("New pipeline")}
                  </Item>
                  <Item
                    value="theme light"
                    icon={<Sun size={15} />}
                    onSelect={() => run(() => setTheme("light"))}
                  >
                    {t("Use light theme")}
                  </Item>
                  <Item
                    value="theme dark"
                    icon={<Moon size={15} />}
                    onSelect={() => run(() => setTheme("dark"))}
                  >
                    {t("Use dark theme")}
                  </Item>
                  <Item
                    value="theme system"
                    icon={<Monitor size={15} />}
                    onSelect={() => run(() => setTheme("system"))}
                  >
                    {t("Match system theme")}
                  </Item>
                  <Item
                    value="keyboard shortcuts help"
                    icon={<Keyboard size={15} />}
                    onSelect={() => run(() => setOpen("shortcuts"))}
                  >
                    {t("Keyboard shortcuts")}
                  </Item>
                  <Item
                    value="sign out log out"
                    icon={<LogOut size={15} />}
                    onSelect={() => run(() => void signOut())}
                  >
                    {t("Sign out")}
                  </Item>
                </Group>

                {teams.length > 1 && (
                  <Group heading={t("Switch team")}>
                    {teams
                      .filter((other) => other.id !== teamId)
                      .map((other) => (
                        <Item
                          key={other.id}
                          value={`team ${other.name}`}
                          icon={<Avatar name={other.name} size={18} shape="square" />}
                          onSelect={() => run(() => navigate(teamPaths(teamKey(other)).home))}
                          hint={t("Team")}
                        >
                          {other.name}
                        </Item>
                      ))}
                  </Group>
                )}
              </Command.List>
              <div className="flex items-center gap-4 border-t border-border-default bg-surface-subtle px-4 py-2 text-xs text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> {t("to move")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>↵</Kbd> {t("to open")}
                </span>
              </div>
            </Command>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <ShortcutSheet
        open={open === "shortcuts"}
        onOpenChange={(next) => setOpen(next ? "shortcuts" : "none")}
      />
    </>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-muted [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  value,
  icon,
  children,
  onSelect,
  hint,
}: {
  value: string;
  icon: ReactNode;
  children: ReactNode;
  onSelect(): void;
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-fg select-none data-[selected=true]:bg-accent-subtle"
    >
      <span className="grid size-5 shrink-0 place-items-center text-fg-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      <ArrowRight size={14} className="hidden text-fg-muted group-data-[selected=true]:block" />
    </Command.Item>
  );
}

function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const mod = isMac() ? "⌘" : t("Ctrl");
  const rows: Array<[string, ReactNode]> = [
    [
      "Search and jump anywhere",
      <>
        <Kbd>{mod}</Kbd>
        <Kbd>K</Kbd>
      </>,
    ],
    ["Show keyboard shortcuts", <Kbd key="q">?</Kbd>],
    ["Collapse or expand the sidebar", <Kbd key="b">[</Kbd>],
    ["Search the list on this page", <Kbd key="s">/</Kbd>],
    [
      "Send a message to the agent",
      <>
        <Kbd>{mod}</Kbd>
        <Kbd>↵</Kbd>
      </>,
    ],
    ["Close a dialog or menu", <Kbd key="e">{t("Esc")}</Kbd>],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Keyboard shortcuts")} size="md">
      <dl className="divide-y divide-border-default">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-fg">{label}</dt>
            <dd className="flex items-center gap-1">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
