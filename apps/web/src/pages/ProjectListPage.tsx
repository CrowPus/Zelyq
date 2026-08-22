import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, EmptyState, Spinner, StatusDot } from "../components/ui";
import { api } from "../lib/api";

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });

  const createProject = useMutation({
    mutationFn: (projectName: string) =>
      api.createProject({ name: projectName, template: "vite-react" }),
    onSuccess: ({ project }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createProject.mutate(name.trim());
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Projects</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every project is a real directory of files you can open, edit, and take with you.
          </p>
        </div>
        {health.data && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <StatusDot status={health.data.status === "ok" ? "ok" : "error"} />
            {health.data.status === "ok" ? "All services healthy" : "Agent unreachable"}
          </div>
        )}
      </header>

      {creating || projects.data?.projects.length === 0 ? (
        <form
          onSubmit={submit}
          className="mb-8 flex gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3"
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            aria-label="Project name"
            className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={createProject.isPending || !name.trim()}
          >
            {createProject.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
      ) : (
        <Button className="mb-6" variant="primary" onClick={() => setCreating(true)}>
          New project
        </Button>
      )}

      {createProject.isError && (
        <p className="mb-6 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {(createProject.error as Error).message}
        </p>
      )}

      {projects.isLoading && <Spinner label="Loading projects…" />}

      {projects.data?.projects.length === 0 && !creating && (
        <EmptyState
          title="No projects yet"
          description="Create one and describe what you want built."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              New project
            </Button>
          }
        />
      )}

      <ul className="divide-y divide-slate-800/80 rounded-lg border border-slate-800">
        {projects.data?.projects.map((project) => (
          <li key={project.id}>
            <Link
              to={`/projects/${project.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-900/60"
            >
              <StatusDot
                status={
                  project.status === "building"
                    ? "busy"
                    : project.status === "error"
                      ? "error"
                      : project.status === "ready"
                        ? "ok"
                        : "idle"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">{project.name}</p>
                <p className="truncate text-xs text-slate-600">
                  {project.description ?? project.template}
                </p>
              </div>
              <time className="shrink-0 text-xs text-slate-600" dateTime={project.updatedAt}>
                {new Date(project.updatedAt).toLocaleDateString()}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
