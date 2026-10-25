import {
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  ChevronsUpDown,
  KeyRound,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings,
  Sun,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { useTheme } from "../hooks/useTheme";
import { Button, IconButton } from "./ui";

export interface Crumb {
  label: string;
  to?: string;
  badge?: ReactNode;
}

/**
 * The application frame: a narrow icon rail and a single top bar carrying the
 * breadcrumb on the left and global controls on the right.
 *
 * Both are fixed height and never scroll. Everything a page renders lives in
 * the remaining area, which is where scrolling belongs.
 */
const RAIL_KEY = "zelyq.rail";
/** Collapsed by default: the rail is navigation, not the work. */
function readRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "open";
  } catch {
    return false;
  }
}

export function AppShell({
  crumbs,
  actions,
  children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(readRailOpen);
  // Remembered per browser, because it is a preference about this person's
  // screen rather than anything the server should know. Storage can throw
  // outright in a private window or a thumbnail capture, so every touch of it
  // is guarded and the default stands if it fails.
  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? "open" : "closed");
    } catch {
      // A preference that cannot be remembered is not worth an error.
    }
  }, [railOpen]);

  return (
    <div
      className={`grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-canvas ${
        railOpen ? "md:grid-cols-[13rem_minmax(0,1fr)]" : "md:grid-cols-[48px_minmax(0,1fr)]"
      }`}
    >
      <Rail open={railOpen} onToggle={() => setRailOpen((value) => !value)} />
      <div className="grid min-w-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden">
        <TopBar crumbs={crumbs} actions={actions} />
        <main className="min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

/**
 * One rail entry, in both shapes. Collapsed it is an icon with its name in the
 * tooltip; open it is the icon and the name. Everything in the rail goes
 * through this so the two states cannot drift apart.
 */
function RailLink({
  to,
  href,
  label,
  icon: Icon,
  active,
  open,
}: {
  to?: string;
  href?: string;
  label: string;
  icon: typeof LayoutGrid;
  active?: boolean;
  open: boolean;
}) {
  const className = `flex items-center rounded-md transition-colors ${
    open ? "h-8 w-full gap-2.5 px-2" : "size-8 justify-center"
  } ${active ? "bg-surface-active text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"}`;
  const content = (
    <>
      <Icon size={16} strokeWidth={1.75} className="shrink-0" />
      {open && <span className="truncate text-xs">{label}</span>}
    </>
  );
  // The name is on screen when open, so the tooltip is only useful collapsed.
  const shared = {
    "aria-label": label,
    ...(open ? {} : { title: label }),
    className,
  };
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" {...shared}>
        {content}
      </a>
    );
  return (
    <Link to={to as string} aria-current={active ? "page" : undefined} {...shared}>
      {content}
    </Link>
  );
}

/**
 * The modules, grouped by what you are doing with them. A new module joins a
 * group instead of making one long list; "Ship" is where Pipelines and Deploy
 * arrive.
 */
const SECTIONS: {
  title: string;
  items: { to: string; label: string; icon: typeof LayoutGrid; match: (p: string) => boolean }[];
}[] = [
  {
    title: "Build",
    items: [
      {
        to: "/",
        label: "Apps",
        icon: LayoutGrid,
        match: (p) => p === "/" || p.startsWith("/projects"),
      },
      {
        to: "/studio",
        label: "Studio",
        icon: Palette,
        match: (p) => p.startsWith("/studio"),
      },
      {
        to: "/agents",
        label: "Agents",
        icon: Bot,
        match: (p) => p.startsWith("/agents"),
      },
    ],
  },
  {
    title: "Secure",
    items: [{ to: "/vault", label: "Vault", icon: KeyRound, match: (p) => p.startsWith("/vault") }],
  },
  {
    title: "Ship",
    items: [
      {
        to: "/pipelines",
        label: "Pipelines",
        icon: Workflow,
        match: (p) => p.startsWith("/pipelines"),
      },
      {
        to: "/deployments",
        label: "Deployments",
        icon: Rocket,
        match: (p) => p.startsWith("/deployments"),
      },
    ],
  },
];

function Rail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const { team } = useActiveTeam();

  return (
    <nav
      aria-label="Primary"
      className={`hidden flex-col gap-1 border-r border-border-default bg-surface py-2 md:flex ${
        open ? "items-stretch px-2" : "items-center"
      }`}
    >
      <div className={`mb-1 flex items-center ${open ? "justify-between" : "justify-center"}`}>
        <Link
          to="/"
          aria-label="Zelyq home"
          className="grid size-8 place-items-center rounded-md text-fg transition-colors hover:bg-surface-hover"
        >
          <Mark />
        </Link>
        {open && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            aria-expanded={true}
            className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <PanelLeftClose size={15} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <TeamSwitcher open={open} />

      {SECTIONS.map((section) => (
        <div key={section.title} className={`flex flex-col gap-1 ${open ? "mt-3" : "mt-2"}`}>
          {open ? (
            <p className="px-2 pb-0.5 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              {section.title}
            </p>
          ) : (
            <span aria-hidden className="mx-auto mb-1 h-px w-5 bg-border-default" />
          )}
          {section.items.map((item) => (
            <RailLink
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              active={item.match(pathname)}
              open={open}
            />
          ))}
        </div>
      ))}
      <div className="flex-1" />

      {!open && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          aria-expanded={false}
          className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </button>
      )}
      {team && (
        <RailLink
          to={`/teams/${team.id}`}
          label="Team"
          icon={Users}
          active={pathname.startsWith("/teams/")}
          open={open}
        />
      )}
      <RailLink to="/docs" label="Docs" icon={BookOpen} active={pathname === "/docs"} open={open} />
      <SettingsLink open={open} />
    </nav>
  );
}

/**
 * Which team you are working in, at the top like a workspace. Choosing one
 * changes which apps are listed, where a new app goes, and which Vault opens.
 */
function TeamSwitcher({ open }: { open: boolean }) {
  const { team, teams, setTeam } = useActiveTeam();
  const [menu, setMenu] = useState(false);
  if (!team) return null;
  const letter = team.name.trim()[0]?.toUpperCase() ?? "T";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenu((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`Team: ${team.name}. Switch team`}
        title={open ? undefined : `Team: ${team.name}`}
        className={`flex items-center rounded-md border border-border-default transition-colors hover:bg-surface-hover ${
          open ? "h-9 w-full gap-2 px-2" : "size-8 justify-center"
        }`}
      >
        <span className="grid size-5 shrink-0 place-items-center rounded bg-fg text-2xs font-semibold text-canvas">
          {letter}
        </span>
        {open && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg">
              {team.name}
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-fg-muted" />
          </>
        )}
      </button>
      {menu && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenu(false)}
          />
          <div
            role="menu"
            className={`absolute z-20 w-56 rounded-lg border border-border-default bg-overlay p-1 shadow-overlay ${
              open ? "top-full left-0 mt-1" : "top-0 left-full ml-2"
            }`}
          >
            <p className="px-2 py-1 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              Teams
            </p>
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={t.id === team.id}
                onClick={() => {
                  setTeam(t.id);
                  setMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-2xs text-fg-muted">{t.role}</span>
                {t.id === team.id && <Check size={12} className="text-fg" />}
              </button>
            ))}
            <div className="my-1 h-px bg-border-default" />
            <Link
              to={`/teams/${team.id}`}
              onClick={() => setMenu(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <Users size={12} /> Members and invites
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/** Instance settings are administrator-only, so the entry point is too. */
function SettingsLink({ open }: { open: boolean }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  if (user?.instanceRole !== "admin") return null;
  return (
    <RailLink
      to="/settings"
      label="Settings"
      icon={Settings}
      active={pathname === "/settings"}
      open={open}
    />
  );
}

function AccountMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        className="grid size-6 place-items-center rounded-full bg-surface-active text-2xs font-medium text-fg transition-colors hover:bg-border-strong"
      >
        {initials(user.name)}
      </button>

      {open && (
        <>
          {/* Click-away layer, so the menu closes like a menu should. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1.5 w-56 rounded-lg border border-border-default bg-overlay p-1 shadow-overlay"
          >
            <div className="border-b border-border-default px-2 py-1.5">
              <p className="truncate text-xs font-medium text-fg">{user.name}</p>
              <p className="truncate font-mono text-2xs text-fg-muted">{user.email}</p>
            </div>
            <Link
              to="/account"
              onClick={() => setOpen(false)}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <UserRound size={13} strokeWidth={1.75} />
              Account settings
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              icon={<LogOut size={13} strokeWidth={1.75} />}
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: ReactNode }) {
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-border-default bg-surface px-2 md:px-3">
      <Link to="/" aria-label="Zelyq home" className="shrink-0 md:hidden">
        <Mark />
      </Link>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, index) => (
          <span key={crumb.to ?? crumb.label} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && (
              <ChevronRight size={13} className="shrink-0 text-fg-muted" strokeWidth={1.75} />
            )}
            {crumb.to ? (
              <Link
                to={crumb.to}
                className="truncate rounded-sm px-1 py-0.5 text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate px-1 py-0.5 text-sm font-medium text-fg">
                {crumb.label}
              </span>
            )}
            {crumb.badge}
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        {actions}
        <Link
          to="/studio"
          aria-label="Studio"
          title="Studio"
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
        >
          <Palette size={16} />
        </Link>
        <ThemeToggle />
        <Link
          to="/vault"
          aria-label="Vault"
          title="Vault"
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
        >
          <KeyRound size={16} />
        </Link>
        <Link
          to="/pipelines"
          aria-label="Pipelines"
          title="Pipelines"
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
        >
          <Workflow size={16} />
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  return (
    <IconButton size="sm" label={`Theme: ${theme}. Switch to ${next}.`} onClick={cycle}>
      <Icon size={14} strokeWidth={1.75} />
    </IconButton>
  );
}

/**
 * The brand mark. Served at 2x the rendered size so it stays crisp on retina
 * displays, and pre-trimmed of its transparent padding so it fills the box.
 */
/**
 * The brand mark, in light and dark variants. `alt` is empty on purpose: the
 * link that wraps this already carries aria-label="Zelyq home", and a second
 * label would make a screen reader announce the same thing twice.
 */
function Mark() {
  return (
    <>
      <img
        src="/zelyq-mark-64.png"
        alt=""
        width={20}
        height={20}
        className="brand-mark--light size-5 select-none"
        draggable={false}
      />
      <img
        src="/zelyq-mark-64-dark.png"
        alt=""
        width={20}
        height={20}
        className="brand-mark--dark size-5 select-none"
        draggable={false}
      />
    </>
  );
}
