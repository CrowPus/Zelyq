import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Plug, Unplug } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, type SupabaseResource } from "../lib/api";
import { Badge, Button, Input, Spinner } from "./ui";

/**
 * Proposal 058 · Phase A. Instance-admin surface (Settings) for connecting
 * Supabase, adding a project resource, and linking Zelyq projects to it. The
 * Management credential is handled entirely server-side — this UI never sees a
 * token, only the public project URL + publishable key on a linked resource.
 */
export function SupabaseIntegration() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pat, setPat] = useState("");

  const config = useQuery({ queryKey: ["supabase-config"], queryFn: api.supabaseConfig });
  const connections = useQuery({
    queryKey: ["supabase-connections"],
    queryFn: api.listSupabaseConnections,
  });
  const connection = connections.data?.connections[0];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["supabase-connections"] });
    qc.invalidateQueries({ queryKey: ["supabase-resources"] });
  };
  const fail = (caught: unknown) => setError((caught as Error).message);

  const connectPat = useMutation({
    mutationFn: () => api.connectSupabasePat(pat.trim()),
    onSuccess: () => {
      setPat("");
      setError(null);
      invalidate();
    },
    onError: fail,
  });

  const startOAuth = useMutation({
    mutationFn: () => api.startSupabaseOAuth(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: fail,
  });

  const disconnect = useMutation({
    mutationFn: (connectionId: string) => api.revokeSupabaseConnection(connectionId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: fail,
  });

  function submitPat(event: FormEvent) {
    event.preventDefault();
    if (pat.trim()) connectPat.mutate();
  }

  return (
    <section className="mt-7">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <Database size={13} strokeWidth={1.75} /> Supabase
      </h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        Connect a Supabase account so a project&apos;s preview runs against a real backend. The
        access token stays on the server — projects only ever receive the public URL and publishable
        key.
      </p>

      {error && (
        <p className="mt-3 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 rounded-lg border border-border-default bg-surface p-3">
        {connections.isLoading && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner /> Loading…
          </div>
        )}

        {!connections.isLoading && !connection && (
          <div className="flex flex-col gap-3">
            <form onSubmit={submitPat} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="password"
                value={pat}
                onChange={(event) => setPat(event.target.value)}
                placeholder="Personal Access Token (sbp_…)"
                aria-label="Supabase Personal Access Token"
                className="sm:flex-1"
              />
              <Button
                type="submit"
                variant="primary"
                icon={<Plug size={13} strokeWidth={1.75} />}
                disabled={connectPat.isPending || !pat.trim()}
              >
                Connect
              </Button>
            </form>
            <p className="text-2xs text-fg-muted">
              A Personal Access Token has full access to your Supabase account. Create one at
              supabase.com → Account → Access Tokens.
            </p>
            {config.data?.oauthConfigured && (
              <Button
                variant="ghost"
                onClick={() => startOAuth.mutate()}
                disabled={startOAuth.isPending}
              >
                Connect with Supabase (OAuth)
              </Button>
            )}
          </div>
        )}

        {connection && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-fg">
                <Badge tone={connection.status === "active" ? "success" : "warning"}>
                  {connection.status}
                </Badge>
                <span className="text-xs text-fg-secondary">
                  {connection.credentialType === "oauth" ? "OAuth" : "Access token"}
                </span>
              </div>
              <Button
                size="sm"
                variant="danger"
                icon={<Unplug size={12} strokeWidth={1.75} />}
                onClick={() => disconnect.mutate(connection.id)}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </div>

            <ResourceManager connectionId={connection.id} onError={fail} />
            <ProjectLinker connectionId={connection.id} onError={fail} />
          </div>
        )}
      </div>
    </section>
  );
}

function ResourceManager({
  connectionId,
  onError,
}: {
  connectionId: string;
  onError: (caught: unknown) => void;
}) {
  const qc = useQueryClient();
  const [ref, setRef] = useState("");
  const [environment, setEnvironment] = useState<SupabaseResource["environment"]>("development");

  const resources = useQuery({
    queryKey: ["supabase-resources", connectionId],
    queryFn: () => api.listSupabaseResources(connectionId),
  });
  const orgProjects = useQuery({
    queryKey: ["supabase-org-projects", connectionId],
    queryFn: () => api.listSupabaseOrgProjects(connectionId),
    retry: false,
  });

  const link = useMutation({
    mutationFn: () => api.linkSupabaseResource(connectionId, { projectRef: ref, environment }),
    onSuccess: () => {
      setRef("");
      qc.invalidateQueries({ queryKey: ["supabase-resources", connectionId] });
    },
    onError,
  });

  return (
    <div className="rounded-md border border-border-default bg-surface-subtle p-2.5">
      <p className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">Projects</p>

      {resources.data?.resources.length === 0 && (
        <p className="mt-1.5 text-xs text-fg-muted">None added yet.</p>
      )}
      <ul className="mt-1.5 flex flex-col gap-1">
        {resources.data?.resources.map((resource) => (
          <li key={resource.id} className="flex items-center gap-2 text-xs text-fg">
            <span className="font-mono text-2xs text-fg-secondary">{resource.projectRef}</span>
            <span className="truncate">{resource.displayName}</span>
            <Badge tone="neutral">{resource.environment}</Badge>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        {orgProjects.data && orgProjects.data.projects.length > 0 ? (
          <select
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            aria-label="Supabase project"
            className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm text-fg sm:flex-1"
          >
            <option value="">Choose a project…</option>
            {orgProjects.data.projects.map((project) => (
              <option key={project.ref} value={project.ref}>
                {project.name} ({project.ref})
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder="Project ref (e.g. abcdefghijklmnop)"
            aria-label="Supabase project ref"
            className="sm:flex-1"
          />
        )}
        <select
          value={environment}
          onChange={(event) =>
            setEnvironment(event.target.value as SupabaseResource["environment"])
          }
          aria-label="Environment"
          className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm text-fg"
        >
          <option value="development">development</option>
          <option value="staging">staging</option>
          <option value="production">production</option>
        </select>
        <Button
          variant="secondary"
          onClick={() => ref.trim() && link.mutate()}
          disabled={link.isPending || !ref.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function ProjectLinker({
  connectionId,
  onError,
}: {
  connectionId: string;
  onError: (caught: unknown) => void;
}) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const resources = useQuery({
    queryKey: ["supabase-resources", connectionId],
    queryFn: () => api.listSupabaseResources(connectionId),
  });

  const setLink = useMutation({
    mutationFn: ({ projectId, resourceId }: { projectId: string; resourceId: string }) =>
      resourceId
        ? api.setProjectSupabaseLink(projectId, resourceId)
        : api.clearProjectSupabaseLink(projectId),
    onSuccess: (_res, { projectId }) =>
      qc.invalidateQueries({ queryKey: ["supabase-project-link", projectId] }),
    onError,
  });

  if (!resources.data || resources.data.resources.length === 0) return null;

  return (
    <div className="rounded-md border border-border-default bg-surface-subtle p-2.5">
      <p className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
        Linked to a project
      </p>
      {(projects.data?.projects ?? []).length === 0 && (
        <p className="mt-1.5 text-xs text-fg-muted">No projects yet.</p>
      )}
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {(projects.data?.projects ?? []).map((project) => (
          <ProjectLinkRow
            key={project.id}
            projectId={project.id}
            projectName={project.name}
            resources={resources.data.resources}
            pending={setLink.isPending}
            onChange={(resourceId) => setLink.mutate({ projectId: project.id, resourceId })}
          />
        ))}
      </ul>
    </div>
  );
}

function ProjectLinkRow({
  projectId,
  projectName,
  resources,
  pending,
  onChange,
}: {
  projectId: string;
  projectName: string;
  resources: SupabaseResource[];
  pending: boolean;
  onChange: (resourceId: string) => void;
}) {
  const link = useQuery({
    queryKey: ["supabase-project-link", projectId],
    queryFn: () => api.getProjectSupabaseLink(projectId),
  });
  const current = link.data?.resource?.id ?? "";

  const applyVerify = useMutation({
    mutationFn: () => api.applyAndVerifySupabase(projectId),
  });

  return (
    <li className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-fg">{projectName}</span>
        <select
          value={current}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Supabase backend for ${projectName}`}
          disabled={pending || link.isLoading}
          className="h-[26px] max-w-[45%] rounded-md border border-border-default bg-surface px-1.5 text-xs text-fg"
        >
          <option value="">Not linked</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.displayName} ({resource.environment})
            </option>
          ))}
        </select>
        {current && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => applyVerify.mutate()}
            disabled={applyVerify.isPending}
          >
            {applyVerify.isPending ? "Running…" : "Apply & verify"}
          </Button>
        )}
      </div>

      {applyVerify.isError && <p className="text-danger">{(applyVerify.error as Error).message}</p>}

      {applyVerify.data && (
        <div className="rounded-md border border-border-default bg-surface p-2 text-2xs">
          {applyVerify.data.migrations.length > 0 && (
            <ul className="mb-1.5">
              {applyVerify.data.migrations.map((migration) => (
                <li key={migration.name} className="text-fg-secondary">
                  <span className="font-mono">{migration.name}</span> — {migration.status}
                </li>
              ))}
            </ul>
          )}
          <p className={applyVerify.data.verification.verified ? "text-success" : "text-fg"}>
            {applyVerify.data.verification.summary}
          </p>
          {applyVerify.data.verification.checks.length > 0 && (
            <ul className="mt-1">
              {applyVerify.data.verification.checks.map((check) => (
                <li key={check.name} className="text-fg-secondary">
                  <span
                    className={
                      check.status === "pass"
                        ? "text-success"
                        : check.status === "fail"
                          ? "text-danger"
                          : "text-fg-muted"
                    }
                  >
                    {check.status === "info" ? "—" : check.status === "pass" ? "✓" : "✗"}
                  </span>{" "}
                  {check.name}: {check.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
