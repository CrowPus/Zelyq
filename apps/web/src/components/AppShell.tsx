import {
  Boxes,
  ChevronRight,
  CircleHelp,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
export function AppShell({
  crumbs,
  actions,
  children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-canvas md:grid-cols-[48px_minmax(0,1fr)]">
      <Rail />
      <div className="grid min-w-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden">
        <TopBar crumbs={crumbs} actions={actions} />
        <main className="min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function Rail() {
  const { pathname } = useLocation();
  const items = [
    {
      to: "/",
      label: "Projects",
      icon: Boxes,
      match: (p: string) => p === "/" || p.startsWith("/projects"),
    },
  ];

  return (
    <nav
      aria-label="Primary"
      className="hidden flex-col items-center gap-1 border-r border-border-default bg-surface py-2 md:flex"
    >
      <Link
        to="/"
        aria-label="Zelyq home"
        className="mb-1 grid size-8 place-items-center rounded-md text-fg transition-colors hover:bg-surface-hover"
      >
        <Mark />
      </Link>

      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-label={item.label}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={`grid size-8 place-items-center rounded-md transition-colors ${
              active
                ? "bg-surface-active text-fg"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            <item.icon size={16} strokeWidth={1.75} />
          </Link>
        );
      })}

      <TeamLinks />

      <div className="flex-1" />

      <a
        href="https://github.com/CrowPus/Zelyq#readme"
        target="_blank"
        rel="noreferrer"
        aria-label="Documentation"
        title="Documentation"
        className="grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <CircleHelp size={16} strokeWidth={1.75} />
      </a>
      <SettingsLink />
    </nav>
  );
}

/** One entry per team the user belongs to, for managing its members. */
function TeamLinks() {
  const { teams } = useSession();
  const { pathname } = useLocation();

  return (
    <>
      {teams.map((team) => {
        const active = pathname === `/teams/${team.id}`;
        return (
          <Link
            key={team.id}
            to={`/teams/${team.id}`}
            aria-label={`${team.name} members`}
            title={`${team.name} · ${team.role}`}
            className={`grid size-8 place-items-center rounded-md transition-colors ${
              active
                ? "bg-surface-active text-fg"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            <Users size={16} strokeWidth={1.75} />
          </Link>
        );
      })}
    </>
  );
}

/** Instance settings are administrator-only, so the entry point is too. */
function SettingsLink() {
  const { user } = useSession();
  const { pathname } = useLocation();
  if (user?.instanceRole !== "admin") return null;

  const active = pathname === "/settings";
  return (
    <Link
      to="/settings"
      aria-label="Settings"
      title="Settings"
      aria-current={active ? "page" : undefined}
      className={`grid size-8 place-items-center rounded-md transition-colors ${
        active ? "bg-surface-active text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
      }`}
    >
      <Settings size={16} strokeWidth={1.75} />
    </Link>
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
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
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
        <ThemeToggle />
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
