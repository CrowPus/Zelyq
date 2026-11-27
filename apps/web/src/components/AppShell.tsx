import * as RadixDialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Camera,
  Check,
  ChevronsUpDown,
  FileText,
  GitBranch,
  HelpCircle,
  House,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Newspaper,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rocket,
  Search,
  ServerCog,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserRound,
  Users,
  Variable,
  Workflow,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { type Theme, useTheme } from "../hooks/useTheme";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { roleName } from "../lib/roles";
import { globalPaths, type TeamPaths, teamKey, teamPaths, useTeamPaths } from "../lib/routes";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { openCommandPalette, openShortcuts } from "./command-palette-store";
import { StarButton } from "./GitHubStar";
import { openHelp } from "./help/help-store";
import { Inbox } from "./Inbox";
import { NewTeamDialog } from "./NewTeamDialog";
import { PlanLimitBanner } from "./PlanLimitBanner";
import { TeamStatusBanner } from "./TeamStatusBanner";
import {
  Avatar,
  ErrorBoundary,
  Kbd,
  Menu,
  MenuCheckItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  SearchField,
  type Status,
  StatusBadge,
  SubMenu,
  Tooltip,
} from "./ui";

export interface Crumb {
  label: string;
  to?: string;
  badge?: ReactNode;
}

/** The app the page is inside, when it is: switches the sidebar to that app's sections. */
export interface ShellApp {
  id: string;
  name: string;
  status?: Status;
  statusLabel?: string;
}

const RAIL_KEY = "zelyq.rail";
const REPO = "https://github.com/CrowPus/Zelyq";

/** Open by default on wide screens; the person's own choice wins after that. */
function readRailOpen(): boolean {
  try {
    const stored = localStorage.getItem(RAIL_KEY);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    // Storage blocked: fall through to the screen-width default.
  }
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
}

/**
 * The application frame. A labelled sidebar on the left (the team's sections,
 * or inside an app, that app's), and a top bar carrying where you are (team ▾
 * / app ▾ / page), search, help, notifications and your account.
 *
 * Both are fixed; everything a page renders lives in the remaining area, which
 * is where scrolling belongs.
 */
export function AppShell({
  crumbs,
  actions,
  children,
  app,
  scope = "team",
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
  app?: ShellApp;
  /** "global" for pages that are not a team's (account, server admin, docs): the tab title leaves the team out. */
  scope?: "team" | "global";
}) {
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const [mobileNav, setMobileNav] = useState(false);
  const { pathname } = useLocation();
  const { team } = useActiveTeam();

  useEffect(() => {
    // The loading skeleton (index.html, AppSkeleton) draws the sidebar the same width.
    document.documentElement.dataset.rail = railOpen ? "open" : "closed";
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? "open" : "closed");
    } catch {
      // A preference that cannot be remembered is not worth an error.
    }
  }, [railOpen]);

  // `[` toggles the sidebar, as in most tools people already use.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      setRailOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A page change closes the phone drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on navigation only.
  useEffect(() => setMobileNav(false), [pathname]);

  // "Page · App · Team — Zelyq", so a person with many tabs can find this one.
  const title = [
    crumbs.length ? crumbs[crumbs.length - 1]!.label : null,
    app?.name,
    scope === "team" ? team?.name : null,
  ]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(" · ");
  useEffect(() => {
    document.title = title ? `${title} — Zelyq` : t("Zelyq");
  }, [title]);

  return (
    <div
      className={`grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-canvas ${
        railOpen ? "md:grid-cols-[15rem_minmax(0,1fr)]" : "md:grid-cols-[3.5rem_minmax(0,1fr)]"
      }`}
    >
      <a href="#main-content" className="skip-link">
        {t("Skip to content")}
      </a>
      <aside
        aria-label={t("Sidebar")}
        className="hidden min-h-0 border-r border-border-default bg-surface md:flex md:flex-col"
      >
        <SidebarContent open={railOpen} app={app} onToggle={() => setRailOpen((value) => !value)} />
      </aside>

      <RadixDialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-20 bg-[var(--backdrop)] md:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-20 flex w-[17rem] max-w-[85vw] flex-col border-r border-border-default bg-surface shadow-dialog focus:outline-none data-[state=open]:animate-[ui-fade-in_150ms_ease-out] md:hidden">
            <RadixDialog.Title className="sr-only">{t("Navigation")}</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              {t("Move between this team’s sections.")}
            </RadixDialog.Description>
            <SidebarContent open app={app} onClose={() => setMobileNav(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="grid min-w-0 grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden">
        <TopBar crumbs={crumbs} actions={actions} app={app} onMenu={() => setMobileNav(true)} />
        <div>
          <AnnouncementBanner />
          <TeamStatusBanner />
          <PlanLimitBanner />
        </div>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 overflow-hidden focus:outline-none"
        >
          <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    Boolean(el.closest?.(".cm-editor"))
  );
}

/* ------------------------------------------------------------------------ */
/* Sidebar                                                                  */
/* ------------------------------------------------------------------------ */

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  match: (path: string, search: string) => boolean;
  hidden?: boolean;
}

/** Which page a switched-off feature takes away (Studio only once both its halves are off). */
function hiddenFeatures(switchedOff: string[] | undefined) {
  const off = new Set(switchedOff ?? []);
  return {
    studio: off.has("studio_image") && off.has("studio_video"),
    agents: off.has("outside_agents"),
    pipelines: off.has("pipelines"),
    deploy: off.has("deploy"),
    ops: off.has("ops"),
  };
}

function teamSections(
  p: TeamPaths,
  hidden: ReturnType<typeof hiddenFeatures>,
): Array<{ title: string | null; items: NavItem[] }> {
  const starts = (prefix: string) => (path: string) =>
    path === prefix || path.startsWith(`${prefix}/`);
  return [
    {
      title: null,
      items: [{ to: p.home, label: t("Home"), icon: House, match: (path) => path === p.home }],
    },
    {
      title: t("Build"),
      items: [
        { to: p.apps, label: t("Apps"), icon: LayoutGrid, match: starts(p.apps) },
        {
          // Straight to the page: /studio only redirects, and a redirect
          // blanks the screen while Studio's code loads.
          to: p.studioImage,
          label: t("Studio"),
          icon: Palette,
          match: starts(p.studio),
          hidden: hidden.studio,
        },
        {
          to: p.agents,
          label: t("Agents"),
          icon: Bot,
          match: starts(p.agents),
          hidden: hidden.agents,
        },
      ],
    },
    {
      title: t("Ship"),
      items: [
        {
          to: p.pipelines,
          label: t("Pipelines"),
          icon: Workflow,
          match: starts(p.pipelines),
          hidden: hidden.pipelines,
        },
        {
          to: p.deployments,
          label: t("Deployments"),
          icon: Rocket,
          match: starts(p.deployments),
          hidden: hidden.deploy,
        },
        { to: p.ops, label: t("Ops"), icon: ServerCog, match: starts(p.ops), hidden: hidden.ops },
      ],
    },
    {
      title: t("Secure"),
      items: [{ to: p.vault, label: t("Vault"), icon: KeyRound, match: starts(p.vault) }],
    },
  ];
}

function appSections(
  p: TeamPaths,
  app: ShellApp,
  canEdit: boolean,
): Array<{ title: string | null; items: NavItem[] }> {
  const build = p.app(app.id);
  return [
    {
      title: null,
      items: [
        {
          to: p.app(app.id, "overview"),
          label: t("Overview"),
          icon: LayoutDashboard,
          match: (path) => path === p.app(app.id, "overview"),
        },
        {
          to: build,
          label: t("Build"),
          icon: Sparkles,
          match: (path, search) => path === build && !search.includes("panel="),
        },
      ],
    },
    {
      title: t("Manage"),
      items: [
        {
          to: p.appPanel(app.id, "variables"),
          label: t("Variables"),
          icon: Variable,
          match: (_, search) => search.includes("panel=variables"),
        },
        {
          to: p.appPanel(app.id, "git"),
          label: t("Git"),
          icon: GitBranch,
          match: (_, search) => search.includes("panel=git"),
          hidden: !canEdit,
        },
        {
          to: p.appPanel(app.id, "snapshots"),
          label: t("Snapshots"),
          icon: Camera,
          match: (_, search) => search.includes("panel=snapshots"),
        },
        {
          to: p.app(app.id, "settings"),
          label: t("Settings"),
          icon: Settings,
          match: (path) => path === p.app(app.id, "settings"),
        },
      ],
    },
  ];
}

function SidebarContent({
  open,
  app,
  onToggle,
  onClose,
}: {
  open: boolean;
  app?: ShellApp;
  onToggle?(): void;
  onClose?(): void;
}) {
  const { pathname, search } = useLocation();
  const { team } = useActiveTeam();
  const { user } = useSession();
  const p = useTeamPaths();
  const hidden = hiddenFeatures(team?.switchedOff);
  const canEdit = team ? roleAtLeast(team.role, "editor") : false;
  const isAdmin = team ? roleAtLeast(team.role, "admin") : false;
  const sections = app ? appSections(p, app, canEdit) : teamSections(p, hidden);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex h-12 shrink-0 items-center ${open ? "justify-between px-3" : "justify-center"}`}
      >
        <Link
          to={p.home || "/"}
          aria-label={t("Zelyq home")}
          className="flex items-center gap-2 rounded-md p-1 text-fg transition-colors hover:bg-surface-hover"
        >
          <Mark />
          {open && (
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{t("Zelyq")}</span>
          )}
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close navigation")}
            className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        ) : (
          open && (
            <Tooltip content={t("Collapse sidebar")} shortcut="[">
              <button
                type="button"
                onClick={onToggle}
                aria-label={t("Collapse sidebar")}
                aria-expanded
                className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <PanelLeftClose size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
          )
        )}
      </div>

      {/* On a phone the breadcrumb has no room for the team, so the drawer carries it. */}
      {onClose && (
        <div className="border-b border-border-default px-3 pb-3">
          <TeamSwitcher />
        </div>
      )}
      <nav
        aria-label={t("Primary")}
        className={`min-h-0 flex-1 overflow-y-auto pt-2 pb-3 ${open ? "px-3" : "px-2"}`}
      >
        {app && (
          <div className="mb-3">
            <SideLink
              to={p.apps}
              label={t("All apps")}
              icon={ArrowLeft}
              open={open}
              active={false}
              muted
            />
            {open && (
              <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5">
                <Avatar name={app.name} size={24} shape="square" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{app.name}</p>
                  {app.status && (
                    <div className="mt-0.5">
                      <StatusBadge status={app.status} label={app.statusLabel} variant="inline" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {sections.map((section, index) => {
          const items = section.items.filter((item) => !item.hidden);
          if (items.length === 0) return null;
          return (
            <div key={section.title ?? index} className={index === 0 ? "" : open ? "mt-5" : "mt-3"}>
              {section.title &&
                (open ? (
                  <p className="mb-1 px-2 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
                    {section.title}
                  </p>
                ) : (
                  <span aria-hidden className="mx-auto mb-2 block h-px w-6 bg-border-default" />
                ))}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.label}>
                    <SideLink
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      open={open}
                      active={item.match(pathname, search)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div
        className={`flex shrink-0 flex-col gap-0.5 border-t border-border-default py-2 ${open ? "px-3" : "items-center px-2"}`}
      >
        {team && (
          <SideLink
            to={p.members}
            label={t("Members")}
            icon={Users}
            open={open}
            active={pathname === p.members}
          />
        )}
        {team && isAdmin && (
          <SideLink
            to={p.settings()}
            label={t("Team settings")}
            icon={SlidersHorizontal}
            open={open}
            active={pathname === p.settings()}
          />
        )}
        {user?.instanceRole === "admin" && (
          <SideLink
            to={globalPaths.admin()}
            label={t("Server admin")}
            icon={Shield}
            open={open}
            active={pathname === "/admin"}
          />
        )}
        {!open && onToggle && (
          <Tooltip content={t("Expand sidebar")} shortcut="[" side="right">
            <button
              type="button"
              onClick={onToggle}
              aria-label={t("Expand sidebar")}
              aria-expanded={false}
              className="mt-1 grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function SideLink({
  to,
  label,
  icon: Icon,
  active,
  open,
  muted,
}: {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  active: boolean;
  open: boolean;
  muted?: boolean;
}) {
  const link = (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      aria-label={open ? undefined : label}
      className={`relative flex items-center rounded-md text-sm transition-colors ${
        open ? "h-8 w-full gap-2.5 px-2" : "mx-auto size-9 justify-center"
      } ${
        active
          ? "bg-accent-subtle font-medium text-fg"
          : muted
            ? "text-fg-muted hover:bg-surface-hover hover:text-fg"
            : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
      }`}
    >
      {active && open && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent"
        />
      )}
      <Icon size={16} strokeWidth={1.75} className={`shrink-0 ${active ? "text-accent" : ""}`} />
      {open && <span className="truncate">{label}</span>}
    </Link>
  );
  return open ? (
    link
  ) : (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  );
}

/* ------------------------------------------------------------------------ */
/* Top bar                                                                  */
/* ------------------------------------------------------------------------ */

function TopBar({
  crumbs,
  actions,
  app,
  onMenu,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  app?: ShellApp;
  onMenu(): void;
}) {
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-border-default bg-surface px-2 sm:px-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t("Open navigation")}
        className="grid size-8 shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
      >
        <MenuIcon size={18} strokeWidth={1.75} />
      </button>

      <nav aria-label={t("Breadcrumb")} className="flex min-w-0 flex-1 items-center">
        <ol className="flex min-w-0 items-center gap-1">
          <li
            className={`min-w-0 shrink items-center ${app || crumbs.length ? "hidden sm:flex" : "flex"}`}
          >
            <TeamSwitcher />
          </li>
          {app && (
            <li className="flex min-w-0 items-center gap-1">
              <Slash className="hidden sm:block" />
              <AppSwitcher app={app} />
            </li>
          )}
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: crumbs are positional; two may share a label.
                key={`${crumb.label}-${index}`}
                className={`min-w-0 items-center gap-1 ${last ? "flex" : "hidden lg:flex"}`}
              >
                <Slash className={index === 0 && !app ? "hidden sm:block" : ""} />
                {crumb.to && !last ? (
                  <Link
                    to={crumb.to}
                    className="truncate rounded-md px-1.5 py-1 text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className="truncate px-1.5 py-1 text-sm font-medium text-fg"
                  >
                    {crumb.label}
                  </span>
                )}
                {crumb.badge && (
                  <span className="hidden shrink-0 sm:inline-flex">{crumb.badge}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <button
        type="button"
        onClick={openCommandPalette}
        className="hidden h-8 w-56 shrink-0 items-center gap-2 rounded-md border border-border-default bg-surface-subtle px-2.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg-secondary lg:flex xl:w-72"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="flex-1 text-left">{t("Search or jump to…")}</span>
        <Kbd>{isMac() ? "⌘K" : t("Ctrl K")}</Kbd>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {actions && <div className="flex items-center gap-1">{actions}</div>}
        <Tooltip content={t("Search")} shortcut={isMac() ? "⌘K" : t("Ctrl K")}>
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={t("Search")}
            className="grid size-8 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover hover:text-fg lg:hidden"
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <StarButton />
        <HelpMenu />
        <Inbox />
        <AccountMenu />
      </div>
    </header>
  );
}

function Slash({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 px-0.5 text-lg font-light text-border-strong select-none ${className}`}
    >
      /
    </span>
  );
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Which team you are in, as the first part of the breadcrumb. Opens a
 * searchable list; picking a team goes to the same section in that team.
 */
function TeamSwitcher() {
  const { team, teams } = useActiveTeam();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  if (!team) return null;

  const filtered = teams.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  function go(next: (typeof teams)[number]) {
    setOpen(false);
    // Keep the section (Pipelines stays Pipelines) but not an app or a run,
    // which belong to the old team.
    const current = team ? teamKey(team) : "";
    const rest = pathname.startsWith(`/${current}/`) ? pathname.slice(current.length + 2) : "";
    const section = rest.split("/")[0] ?? "";
    const keep = [
      "apps",
      "studio",
      "agents",
      "vault",
      "pipelines",
      "deployments",
      "ops",
      "members",
      "settings",
    ];
    const base = teamPaths(teamKey(next)).home;
    navigate(keep.includes(section) ? `${base}/${section}` : base);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        className="w-72 p-1"
        trigger={
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            <Avatar name={team.name} size={20} shape="square" />
            <span className="max-w-[12rem] truncate">{team.name}</span>
            <span className="sr-only">{t(", switch team")}</span>
            <ChevronsUpDown size={13} className="shrink-0 text-fg-muted" />
          </button>
        }
      >
        {teams.length > 5 && (
          <div className="p-1">
            <SearchField
              value={query}
              onValueChange={setQuery}
              placeholder={t("Find a team")}
              aria-label={t("Find a team")}
              autoFocus
            />
          </div>
        )}
        <p className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
          {t("Teams")}
        </p>
        <ul className="max-h-72 overflow-y-auto">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => go(t)}
                aria-current={t.id === team.id ? "true" : undefined}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-hover"
              >
                <Avatar name={t.name} size={20} shape="square" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs text-fg-muted capitalize">{roleName(t.role)}</span>
                <span className="grid w-4 place-items-center">
                  {t.id === team.id && <Check size={14} className="text-accent" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="-mx-1 my-1 h-px bg-border-default" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg"
        >
          <Plus size={14} /> {t("New team")}
        </button>
        <Link
          to={teamPaths(teamKey(team)).members}
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg"
        >
          <Users size={14} /> {t("Members and invites")}
        </Link>
      </Popover>
      <NewTeamDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** The app you are in, as the second part of the breadcrumb, switchable in place. */
function AppSwitcher({ app }: { app: ShellApp }) {
  const { team } = useActiveTeam();
  const p = useTeamPaths();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: open,
    staleTime: 30_000,
  });
  const apps = useMemo(
    () =>
      (projects.data?.projects ?? [])
        .filter((project) => !team || project.teamId === team.id)
        .filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))),
    [projects.data, team, query],
  );
  // Switching apps keeps the section you were looking at.
  const section: "overview" | "settings" | "build" = pathname.endsWith("/overview")
    ? "overview"
    : pathname.endsWith("/settings")
      ? "settings"
      : "build";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      className="w-80 p-1"
      trigger={
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          <span className="max-w-[14rem] truncate">{app.name}</span>
          <span className="sr-only">{t(", switch app")}</span>
          <ChevronsUpDown size={13} className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      <div className="p-1">
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={t("Find an app")}
          aria-label={t("Find an app")}
          autoFocus
          onKeyDown={(event) => {
            // Enter opens the first match, so the keyboard alone is enough.
            if (event.key === "Enter" && apps[0]) {
              event.preventDefault();
              setOpen(false);
              navigate(p.app(apps[0].id, section));
            }
          }}
        />
      </div>
      <ul className="max-h-80 overflow-y-auto py-1">
        {projects.isLoading && (
          <li className="px-2 py-1.5 text-sm text-fg-muted">{t("Loading apps…")}</li>
        )}
        {!projects.isLoading && apps.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-fg-muted">
            {t("No app matches “{query}”.", { query })}
          </li>
        )}
        {apps.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(p.app(project.id, section));
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
            >
              <Avatar name={project.name} size={20} shape="square" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.id === app.id && <Check size={14} className="text-accent" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="-mx-1 my-1 h-px bg-border-default" />
      <Link
        to={p.apps}
        onClick={() => setOpen(false)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg"
      >
        <LayoutGrid size={14} /> {t("All apps")}
      </Link>
      <Link
        to={p.newApp}
        onClick={() => setOpen(false)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-hover hover:text-fg"
      >
        <Plus size={14} /> {t("New app")}
      </Link>
    </Popover>
  );
}

function HelpMenu() {
  return (
    <Menu
      width="w-60"
      trigger={
        <button
          type="button"
          aria-label={t("Help")}
          className="grid size-8 place-items-center rounded-md text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <HelpCircle size={16} strokeWidth={1.75} />
        </button>
      }
    >
      <MenuLabel>{t("Help")}</MenuLabel>
      <MenuItem icon={<BookOpen size={14} />} onSelect={() => openHelp()}>
        {t("Help for this page")}
      </MenuItem>
      <MenuItem asChild>
        <Link to={globalPaths.docs}>
          <FileText size={14} className="text-fg-muted" /> {t("Beginner’s guide")}
        </Link>
      </MenuItem>
      <MenuItem icon={<Keyboard size={14} />} shortcut="?" onSelect={openShortcuts}>
        {t("Keyboard shortcuts")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem asChild>
        <a href={`${REPO}/releases`} target="_blank" rel="noreferrer">
          <Newspaper size={14} className="text-fg-muted" /> {t("What’s new")}
        </a>
      </MenuItem>
      <MenuItem asChild>
        <a href={`${REPO}/issues/new`} target="_blank" rel="noreferrer">
          <LifeBuoy size={14} className="text-fg-muted" /> {t("Report a problem")}
        </a>
      </MenuItem>
    </Menu>
  );
}

function AccountMenu() {
  const { user, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  if (!user) return null;

  const themes: Array<{ id: Theme; label: string }> = [
    { id: "light", label: t("Light") },
    { id: "dark", label: t("Dark") },
    { id: "system", label: t("Match system") },
  ];

  return (
    <Menu
      width="w-64"
      trigger={
        <button
          type="button"
          className="ml-1 grid size-8 place-items-center rounded-full transition-[box-shadow] hover:ring-2 hover:ring-border-strong"
        >
          <Avatar name={user.name} size={28} />
          <span className="sr-only">{t("Account menu for {name}", { name: user.name })}</span>
        </button>
      }
    >
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar name={user.name} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{user.name}</p>
          <p className="truncate text-xs text-fg-muted">{user.email}</p>
        </div>
      </div>
      <MenuSeparator />
      <MenuItem icon={<UserRound size={14} />} onSelect={() => navigate(globalPaths.account)}>
        {t("Account settings")}
      </MenuItem>
      <SubMenu
        label={t("Theme")}
        icon={
          theme === "dark" ? (
            <Moon size={14} />
          ) : theme === "light" ? (
            <Sun size={14} />
          ) : (
            <Monitor size={14} />
          )
        }
      >
        {themes.map((t) => (
          <MenuCheckItem key={t.id} checked={theme === t.id} onSelect={() => setTheme(t.id)}>
            {t.label}
          </MenuCheckItem>
        ))}
      </SubMenu>
      {user.instanceRole === "admin" && (
        <MenuItem icon={<Shield size={14} />} onSelect={() => navigate(globalPaths.admin())}>
          {t("Server administration")}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<LogOut size={14} />} onSelect={() => void signOut()}>
        {t("Sign out")}
      </MenuItem>
    </Menu>
  );
}

/**
 * The brand mark, in light and dark variants. `alt` is empty on purpose: the
 * link that wraps this already carries aria-label="Zelyq home".
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <>
      <img
        src="/zelyq-mark-64.png"
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="brand-mark--light select-none"
        draggable={false}
      />
      <img
        src="/zelyq-mark-64-dark.png"
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="brand-mark--dark select-none"
        draggable={false}
      />
    </>
  );
}
