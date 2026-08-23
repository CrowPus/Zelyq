import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast } from "@zelyq/core";
import { Box, CircleAlert, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, EmptyState, IconButton, Input, Spinner, StatusDot } from "../components/ui";
import { api } from "../lib/api";

const STATUS_TONE = {
  ready: "success",
  building: "warning",
  creating: "warning",
  error: "danger",
  archived: "neutral",
} as const;

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [confirming, setConfirming] = useState<string | null>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  // Deleting takes admin on the project's team. The server decides for real;
  // this only keeps a button nobody may press off the screen.
  const teams = useQuery({ queryKey: ["teams"], queryFn: api.listTeams });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });

  const createProject = useMutation({
    mutationFn: (projectName: string) =>
      api.createProject({ name: projectName, template: "vite-react" }),
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
    if (trimmed) createProject.mutate(trimmed);
  }

  const list = projects.data?.projects ?? [];
  const agent = health.data?.agent;
  const roleByTeam = new Map((teams.data?.teams ?? []).map((team) => [team.id, team.role]));
  const canDelete = (teamId: string): boolean => {
    const role = roleByTeam.get(teamId);
    return role !== undefined && roleAtLeast(role, "admin");
  };
  // Reserve the actions column for the whole table or none of it, so the header
  // labels and the rows stay on the same grid.
  const showActions = list.some((project) => canDelete(project.teamId));

  return (
    <AppShell
      crumbs={[{ label: "Projects" }]}
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} strokeWidth={2} />}
          onClick={() => setComposing(true)}
        >
          New project
        </Button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-fg">Projects</h1>
              <p className="mt-1 text-xs text-fg-secondary">
                Each project is a real directory of files you can open, edit, and take with you.
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
            <form onSubmit={submit} className="mt-6 flex items-center gap-2">
              <Input
                ref={inputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setComposing(false)}
                placeholder="Project name"
                aria-label="Project name"
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

          <div className="mt-6 overflow-hidden rounded-lg border border-border-default bg-surface">
            {projects.isLoading && (
              <div className="flex items-center gap-2 px-4 py-8 text-xs text-fg-muted">
                <Spinner /> Loading projects…
              </div>
            )}

            {!projects.isLoading && list.length === 0 && (
              <EmptyState
                title="No projects yet"
                description="Create one and describe what you want built. The agent works in a real workspace, so everything it writes is a file you can read."
                action={
                  <Button
                    variant="primary"
                    icon={<Plus size={13} strokeWidth={2} />}
                    onClick={() => setComposing(true)}
                  >
                    New project
                  </Button>
                }
              />
            )}

            {list.length > 0 && (
              <>
                <div
                  className={`grid grid-cols-[minmax(0,1fr)_92px] items-center gap-3 border-b border-border-default bg-surface-subtle py-2 pl-4 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase sm:grid-cols-[minmax(0,1fr)_120px_150px] sm:gap-4 ${
                    showActions ? "pr-12" : "pr-4"
                  }`}
                >
                  <span>Name</span>
                  <span>Status</span>
                  <span className="hidden text-right sm:block">Last updated</span>
                </div>
                <ul>
                  {list.map((project) => (
                    <li
                      key={project.id}
                      className="flex items-center border-b border-border-default last:border-b-0"
                    >
                      {confirming === project.id ? (
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5 pr-3 pl-4">
                          <span className="min-w-0 truncate text-xs text-fg-secondary">
                            Delete <span className="text-fg">{project.name}</span> and its files?
                            This cannot be undone.
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
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
                      ) : (
                        <>
                          <Link
                            to={`/projects/${project.id}`}
                            className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_92px] items-center gap-3 py-2.5 pl-4 transition-colors hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_120px_150px] sm:gap-4"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <Box
                                size={15}
                                strokeWidth={1.75}
                                className="shrink-0 text-fg-muted"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-fg">
                                  {project.name}
                                </span>
                                <span className="block truncate font-mono text-2xs text-fg-muted">
                                  {project.description ?? project.template}
                                </span>
                              </span>
                            </span>
                            <span>
                              <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                                {project.status}
                              </Badge>
                            </span>
                            <time
                              dateTime={project.updatedAt}
                              className="hidden text-right text-xs text-fg-muted tabular-nums sm:block"
                            >
                              {formatRelative(project.updatedAt)}
                            </time>
                          </Link>

                          {/* A real column, not an overlay: nothing can sit on
                              top of the timestamp this way. */}
                          {showActions && (
                            <span className="flex w-12 shrink-0 justify-center">
                              {canDelete(project.teamId) && (
                                <IconButton
                                  size="sm"
                                  variant="danger"
                                  label={`Delete ${project.name}`}
                                  onClick={() => setConfirming(project.id)}
                                >
                                  <Trash2 size={13} strokeWidth={1.75} />
                                </IconButton>
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
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
