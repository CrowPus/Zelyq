import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Box, CircleAlert, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  FilterSelect,
  ListToolbar,
  matches,
  NothingMatches,
  Pager,
  pageOf,
  SearchBox,
  useListParams,
} from "../components/ListControls";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  PasswordInput,
  Spinner,
  StatusDot,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";

const STATUS_TONE = {
  ready: "success",
  building: "warning",
  creating: "warning",
  error: "danger",
  archived: "neutral",
} as const;

/** Cards sit three to a row on a wide screen and two on a narrower one: 12
 *  fills whole rows in both, where the usual 10 left one card alone. */
const APPS_PER_PAGE = 12;

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitToken, setGitToken] = useState("");
  /** Which starter stack a new (non-clone) project scaffolds from. */
  const [template, setTemplate] = useState("vite-react");
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [confirming, setConfirming] = useState<string | null>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  // The team chosen at the top of the sidebar: its apps are the ones listed,
  // and a new app goes into it.
  const { team } = useActiveTeam();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  // Deleting takes admin on the project's team. The server decides for real;
  // this only keeps a button nobody may press off the screen.
  const teams = useQuery({ queryKey: ["teams"], queryFn: api.listTeams });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });

  /** Template name → its icon, for the rows in the project list. */
  const templateIcons = useMemo(
    () =>
      new Map(
        (templates.data?.templates ?? [])
          .filter((option) => option.icon)
          .map((option) => [option.name, option.icon as string]),
      ),
    [templates.data],
  );

  const createProject = useMutation({
    mutationFn: (input: { name: string; gitUrl?: string; gitToken?: string; template?: string }) =>
      api.createProject({
        template: "vite-react",
        ...input,
        ...(team ? { teamId: team.id } : {}),
      }),
    // Whatever happens, the token does not linger in the page.
    onSettled: () => setGitToken(""),
    onSuccess: ({ project }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const repository = gitUrl.trim();
    const token = gitToken.trim();
    if (!trimmed) return;
    if (!repository) {
      // Template only applies to a fresh scaffold; a clone brings its own files.
      createProject.mutate({ name: trimmed, template });
      return;
    }
    createProject.mutate({
      name: trimmed,
      gitUrl: repository,
      ...(token ? { gitToken: token } : {}),
    });
  }

  const filters = useListParams(`apps.${team?.id ?? "all"}`, ["q", "status", "stack", "sort"]);
  const q = filters.get("q");
  const statusFilter = filters.get("status");
  const stack = filters.get("stack");
  const sort = filters.get("sort");
  const all = (projects.data?.projects ?? []).filter(
    (project) => !team || project.teamId === team.id,
  );
  const stackTitles = new Map(
    (templates.data?.templates ?? []).map((option) => [option.name, option.title]),
  );
  const statuses = [...new Set(all.map((project) => project.status))].sort();
  const stacks = [...new Set(all.map((project) => project.template))].sort();
  const shown = all
    .filter(
      (project) =>
        matches(q, project.name, project.description, project.template) &&
        (!statusFilter || project.status === statusFilter) &&
        (!stack || project.template === stack),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldest"
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const { rows: list, page } = pageOf(shown, filters.page, APPS_PER_PAGE);
  const agent = health.data?.agent;
  const roleByTeam = new Map((teams.data?.teams ?? []).map((team) => [team.id, team.role]));
  const canDelete = (teamId: string): boolean => {
    const role = roleByTeam.get(teamId);
    return role !== undefined && roleAtLeast(role, "admin");
  };

  return (
    <AppShell
      crumbs={[{ label: "Apps" }]}
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} strokeWidth={2} />}
          onClick={() => setComposing(true)}
        >
          New app
        </Button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-fg">Apps</h1>
              <p className="mt-1 text-xs text-fg-secondary">
                Build an app by describing it. Each one is a real directory of files you can open,
                edit, and take with you.
              </p>
            </div>
            {agent && (
              <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                <StatusDot tone={agent.status === "ok" ? "success" : "danger"} />
                <span className="font-mono">{agent.model ?? "agent"}</span>
              </div>
            )}
          </div>

          {composing && (
            <form onSubmit={submit} className="mt-6 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Escape" && setComposing(false)}
                  placeholder="App name"
                  aria-label="App name"
                  className="max-w-xs"
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={createProject.isPending || !name.trim()}
                >
                  {createProject.isPending ? "Creating…" : "Create"}
                </Button>
                <Button variant="ghost" onClick={() => setComposing(false)}>
                  Cancel
                </Button>
              </div>

              {!gitUrl.trim() && (templates.data?.templates.length ?? 0) > 1 && (
                <fieldset className="mt-1 flex flex-col gap-1.5">
                  <legend className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
                    Stack
                  </legend>
                  {/* A card per stack rather than a row of text: the icon is
                      what someone recognises, and it is doing the work the
                      title used to do on its own. */}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.data?.templates.map((option) => {
                      const active = option.name === template;
                      return (
                        <button
                          key={option.name}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setTemplate(option.name)}
                          className={`group flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                            active
                              ? "border-focus bg-surface-subtle shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_20%,transparent)]"
                              : "border-border-default bg-surface hover:border-border-strong hover:bg-surface-subtle"
                          }`}
                        >
                          {option.icon ? (
                            <img
                              src={`/${option.icon}`}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                              decoding="async"
                              className={`size-10 shrink-0 object-contain transition-transform duration-200 group-hover:scale-105 ${
                                active ? "" : "opacity-85 group-hover:opacity-100"
                              }`}
                            />
                          ) : (
                            // A stack with no icon still lines up with the rest.
                            <span
                              aria-hidden
                              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-strong text-sm font-semibold text-fg-secondary"
                            >
                              {option.title.slice(0, 1)}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-fg">
                              {option.title}
                            </span>
                            <span className="mt-0.5 block text-2xs leading-4 text-fg-secondary">
                              {option.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <Input
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setComposing(false)}
                placeholder="https://github.com/you/your-repo.git — or leave empty for a new app"
                aria-label="Repository URL"
                className="max-w-xl"
              />
              {gitUrl.trim() && (
                <PasswordInput
                  value={gitToken}
                  onChange={(event) => setGitToken(event.target.value)}
                  onKeyDown={(event) => event.key === "Escape" && setComposing(false)}
                  placeholder="Access token — only if the repository is private"
                  aria-label="Repository access token"
                  autoComplete="off"
                  className="max-w-xl"
                />
              )}

              <p className="text-2xs text-fg-muted">
                {gitUrl.trim()
                  ? "Zelyq clones the repository and works on a copy — it never pushes, so a " +
                    "read-only token is enough. The token is used once and never stored. Cloning " +
                    "can take a minute."
                  : (templates.data?.templates.length ?? 0) > 1
                    ? "Leave the address empty and Zelyq scaffolds a new app in the stack you pick above."
                    : "Leave the address empty and Zelyq starts a new React app instead."}
              </p>
            </form>
          )}

          {deleteProject.isError && (
            <p className="mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} />
              {(deleteProject.error as Error).message}
            </p>
          )}

          {createProject.isError && (
            <p className="mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} />
              {(createProject.error as Error).message}
            </p>
          )}

          {all.length > 0 && (
            <div className="mt-6">
              <ListToolbar>
                <SearchBox
                  value={q}
                  onChange={(value) => filters.set({ q: value })}
                  placeholder="Search apps"
                />
                {statuses.length > 1 && (
                  <FilterSelect
                    label="Status"
                    value={statusFilter}
                    onChange={(value) => filters.set({ status: value })}
                    options={[
                      { value: "", label: "Any status" },
                      ...statuses.map((value) => ({
                        value,
                        label: `${value[0]?.toUpperCase()}${value.slice(1)} (${all.filter((project) => project.status === value).length})`,
                      })),
                    ]}
                  />
                )}
                {stacks.length > 1 && (
                  <FilterSelect
                    label="Stack"
                    value={stack}
                    onChange={(value) => filters.set({ stack: value })}
                    options={[
                      { value: "", label: "Any stack" },
                      ...stacks.map((value) => ({
                        value,
                        label: `${stackTitles.get(value) ?? value} (${all.filter((project) => project.template === value).length})`,
                      })),
                    ]}
                  />
                )}
                <FilterSelect
                  label="Order"
                  value={sort}
                  onChange={(value) => filters.set({ sort: value })}
                  options={[
                    { value: "", label: "Recently updated" },
                    { value: "name", label: "Name A–Z" },
                    { value: "oldest", label: "Least recently updated" },
                  ]}
                />
              </ListToolbar>
            </div>
          )}

          {all.length > 0 && shown.length === 0 && <NothingMatches onClear={filters.clear} />}

          {all.length === 0 && (
            <div className="mt-6 overflow-hidden rounded-lg border border-border-default bg-surface">
              {projects.isLoading && (
                <div className="flex items-center gap-2 px-4 py-8 text-xs text-fg-muted">
                  <Spinner /> Loading apps…
                </div>
              )}

              {!projects.isLoading && all.length === 0 && (
                <EmptyState
                  title={team ? `No apps in ${team.name} yet` : "No apps yet"}
                  description="Create one and describe what you want built. The agent works in a real workspace, so everything it writes is a file you can read."
                  action={
                    <Button
                      variant="primary"
                      icon={<Plus size={13} strokeWidth={2} />}
                      onClick={() => setComposing(true)}
                    >
                      New app
                    </Button>
                  }
                />
              )}
            </div>
          )}

          {list.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((project) => (
                <li
                  key={project.id}
                  className="group relative overflow-hidden rounded-xl border border-border-default bg-surface transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[var(--shadow-overlay)]"
                >
                  <Link to={`/projects/${project.id}`} className="block">
                    <span className="relative block aspect-[16/10] overflow-hidden border-b border-border-default bg-surface-subtle">
                      {project.thumbnailAt ? (
                        <img
                          src={`/api/projects/${project.id}/thumbnail?v=${encodeURIComponent(project.thumbnailAt)}`}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        // No picture yet: it is taken from the running preview,
                        // the first time the app is opened or after the agent
                        // changes it.
                        <span className="flex size-full flex-col items-center justify-center gap-2 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:14px_14px]">
                          {templateIcons.get(project.template) ? (
                            <img
                              src={`/${templateIcons.get(project.template)}`}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                              decoding="async"
                              className="size-10 object-contain opacity-80"
                            />
                          ) : (
                            <Box size={32} strokeWidth={1.5} className="text-fg-muted" />
                          )}
                          <span className="text-2xs text-fg-muted">Open it to take a preview</span>
                        </span>
                      )}
                      {project.status !== "ready" && (
                        <span className="absolute top-2 left-2">
                          <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                            {project.status}
                          </Badge>
                        </span>
                      )}
                    </span>
                    <span className="flex items-start gap-2.5 px-3.5 py-3">
                      {/* The stack's own mark, so the cards are scannable by
                        what each app is. Falls back to the generic box for a
                        cloned repository, or a stack this runtime no longer
                        offers. */}
                      {templateIcons.get(project.template) ? (
                        <img
                          src={`/${templateIcons.get(project.template)}`}
                          alt=""
                          width={18}
                          height={18}
                          loading="lazy"
                          decoding="async"
                          className="mt-px size-[18px] shrink-0 object-contain"
                        />
                      ) : (
                        <Box
                          size={15}
                          strokeWidth={1.75}
                          className="mt-0.5 shrink-0 text-fg-muted"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          {project.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-muted">
                          <span className="min-w-0 truncate font-mono">
                            {project.description ??
                              stackTitles.get(project.template) ??
                              project.template}
                          </span>
                          <span aria-hidden>·</span>
                          <time dateTime={project.updatedAt} className="shrink-0 tabular-nums">
                            {formatRelative(project.updatedAt)}
                          </time>
                        </span>
                      </span>
                    </span>
                  </Link>

                  {/* Over the picture's corner, shown on hover or keyboard
                    focus, so the card stays a clean picture otherwise. */}
                  {canDelete(project.teamId) && confirming !== project.id && (
                    <span className="absolute top-2 right-2 rounded-md bg-surface/90 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                      <IconButton
                        size="sm"
                        variant="danger"
                        label={`Delete ${project.name}`}
                        onClick={() => setConfirming(project.id)}
                      >
                        <Trash2 size={13} strokeWidth={1.75} />
                      </IconButton>
                    </span>
                  )}

                  {confirming === project.id && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/95 p-4 text-center backdrop-blur-sm">
                      <span className="text-xs text-fg-secondary">
                        Delete <span className="text-fg">{project.name}</span> and its files? This
                        cannot be undone.
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={deleteProject.isPending}
                          onClick={() => deleteProject.mutate(project.id)}
                        >
                          {deleteProject.isPending ? "Deleting…" : "Delete"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={page}
            total={shown.length}
            size={APPS_PER_PAGE}
            noun="apps"
            all={all.length}
            onPage={(n) => filters.set({ page: String(n) })}
          />
        </div>
      </div>
    </AppShell>
  );
}

/** Relative for the recent past, absolute once "3 days ago" stops helping. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
