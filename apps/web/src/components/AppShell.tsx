import {
  Boxes,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  ImagePlus,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
  icon: typeof Boxes;
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

function Rail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  // Projects first: it is what this product is for. The studios are tools you
  // reach for while building one.
  const items = [
    {
      to: "/",
      label: "Projects",
      icon: Boxes,
      match: (p: string) => p === "/" || p.startsWith("/projects"),
    },
    {
      to: "/image-studio",
      label: "Image Studio",
      icon: ImagePlus,
      match: (p: string) => p.startsWith("/image-studio"),
    },
    {
      to: "/video-studio",
      label: "Video Studio",
      icon: Clapperboard,
      match: (p: string) => p.startsWith("/video-studio"),
    },
  ];

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

      {items.map((item) => (
        <RailLink
          key={item.to}
          to={item.to}
          label={item.label}
          icon={item.icon}
          active={item.match(pathname)}
          open={open}
        />
      ))}

      <TeamLinks open={open} />

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
      <RailLink
        href="https://github.com/CrowPus/Zelyq#readme"
        label="Documentation"
        icon={CircleHelp}
        open={open}
      />
      <SettingsLink open={open} />
    </nav>
  );
}

/** One entry per team the user belongs to, for managing its members. */
function TeamLinks({ open }: { open: boolean }) {
  const { teams } = useSession();
  const { pathname } = useLocation();

  return (
    <>
      {teams.map((team) => {
        const active = pathname === `/teams/${team.id}`;
        return (
          <RailLink
            key={team.id}
            to={`/teams/${team.id}`}
            label={team.name}
            icon={Users}
            active={active}
            open={open}
          />
        );
      })}
    </>
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
          to="/image-studio"
          aria-label="Image Studio"
          title="Image Studio"
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
        >
          <ImagePlus size={16} />
        </Link>
        <ThemeToggle />
        <Link
          to="/video-studio"
          aria-label="Video Studio"
          title="Video Studio"
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-fg-secondary hover:bg-surface-hover md:hidden"
        >
          <Clapperboard size={16} />
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
