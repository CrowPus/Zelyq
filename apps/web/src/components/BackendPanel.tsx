import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackendConfigurationResolved } from "@zelyq/core";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui";

export function BackendPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState<"development" | "test" | "production">(
    "development",
  );
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["backend", projectId, environment],
    queryFn: () => api.getBackend(projectId, environment),
    enabled: open,
  });
  // The resolved shape: the panel always holds a complete configuration, so
  // nothing here has to cope with a half-filled form.
  const [form, setForm] = useState<BackendConfigurationResolved>({
    engine: "none",
    ownership: "external",
    tables: [],
    readOnly: true,
    auth: "none",
    secrets: {},
  });
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [inspection, setInspection] = useState("");
  useEffect(() => {
    if (query.data) {
      const {
        configured: _configured,
        secretNames: _names,
        revision: _revision,
        ...config
      } = query.data.configuration;
      setForm({ ...config, secrets: {} });
      setSecretValue("");
      setInspection("");
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      api.saveBackend(
        projectId,
        {
          ...form,
          secrets: { ...form.secrets, ...(secretName ? { [secretName]: secretValue } : {}) },
        },
        environment,
      ),
    onSuccess: async () => {
      setSecretValue("");
      setSecretName("");
      await cache.invalidateQueries({ queryKey: ["backend", projectId] });
      await cache.invalidateQueries({ queryKey: ["preview", projectId] });
    },
  });
  const inspect = useMutation({
    mutationFn: () => api.inspectBackend(projectId),
    onSuccess: (value) => setInspection(JSON.stringify(value, null, 2)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectBackend(projectId, environment),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["backend", projectId] }),
  });
  const inputClass = "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-fg";
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Backend
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Backend configuration"
            className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl border border-border bg-surface p-6 text-fg shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Backend configuration</h2>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            <p className="mb-4 text-sm text-fg-muted">
              Connect your database and identity provider. Existing tables are never changed by
              connecting or inspecting. Previews use development settings.
            </p>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <label>
                Environment
                <select
                  className={inputClass}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as typeof environment)}
                >
                  <option value="development">development — used by previews and checks</option>
                  <option value="test">test — stored, not yet used</option>
                  <option value="production">production — stored, not yet used</option>
                </select>
              </label>
              {environment !== "development" && (
                <p role="status" className="text-xs text-fg-muted">
                  Saved securely, but nothing reads this environment yet: previews, checks and
                  connection tests all use development. Deployment will use it.
                </p>
              )}
              <label>
                Database
                <select
                  className={inputClass}
                  value={form.engine}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      engine: e.target.value as typeof form.engine,
                      databaseUrl: null,
                    })
                  }
                >
                  <option value="none">No database</option>
                  <option value="postgresql">My PostgreSQL database</option>
                  <option value="mysql">My MySQL database</option>
                  <option value="sqlite">SQLite — persistent local file</option>
                  <option value="supabase">Linked Supabase resource</option>
                </select>
              </label>
              {["postgresql", "mysql"].includes(form.engine) && (
                <label>
                  Connection URL
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete="new-password"
                    value={form.databaseUrl ?? ""}
                    placeholder={
                      query.data?.configuration.configured
                        ? "Saved — leave unchanged to keep"
                        : `${form.engine}://user:password@host/database`
                    }
                    onChange={(e) => setForm({ ...form, databaseUrl: e.target.value })}
                  />
                </label>
              )}
              <label>
                Schema ownership
                <select
                  className={inputClass}
                  value={form.ownership}
                  onChange={(e) =>
                    setForm({ ...form, ownership: e.target.value as typeof form.ownership })
                  }
                >
                  <option value="external">Existing schema — managed outside this app</option>
                  <option value="application">
                    Application-owned schema — migrations reviewed separately
                  </option>
                </select>
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={form.readOnly}
                  onChange={(e) => setForm({ ...form, readOnly: e.target.checked })}
                />
                Read-only access (use read-only database credentials)
              </label>
              <label>
                Schema (optional)
                <input
                  className={inputClass}
                  value={form.schema ?? ""}
                  onChange={(e) => setForm({ ...form, schema: e.target.value || undefined })}
                />
              </label>
              <label>
                Tables to inspect (comma-separated)
                <input
                  className={inputClass}
                  value={form.tables.join(",")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      tables: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Application authentication
                <select
                  className={inputClass}
                  value={form.auth}
                  onChange={(e) => setForm({ ...form, auth: e.target.value as typeof form.auth })}
                >
                  <option value="none">Not configured — protected routes remain unavailable</option>
                  <option value="jwt">Existing provider — signed access tokens</option>
                </select>
              </label>
              {form.auth === "jwt" &&
                (["issuer", "audience", "jwksUrl"] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        issuer: "Token issuer (HTTPS)",
                        audience: "API audience",
                        jwksUrl: "Signing keys URL (HTTPS)",
                      }[key]
                    }
                    <input
                      className={inputClass}
                      value={form[key] ?? ""}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value || undefined })}
                    />
                  </label>
                ))}
              <fieldset className="grid gap-2">
                <legend className="mb-2">Backend secrets</legend>
                {query.data?.configuration.secretNames.map((name) => (
                  <label key={name} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.secrets[name] === null}
                      onChange={(e) => {
                        const secrets = { ...form.secrets };
                        if (e.target.checked) secrets[name] = null;
                        else delete secrets[name];
                        setForm({ ...form, secrets });
                      }}
                    />
                    Remove {name}
                  </label>
                ))}
                <input
                  aria-label="Secret name"
                  className={inputClass}
                  placeholder="API_KEY"
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                />
                <input
                  aria-label="Secret value"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  placeholder="New value (never shown again)"
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                />
              </fieldset>
              {(query.error || save.error || inspect.error || disconnect.error) && (
                <p role="alert" className="text-sm text-red-500">
                  {String(query.error || save.error || inspect.error || disconnect.error)}
                </p>
              )}
              {save.isSuccess && (
                <p role="status" className="text-sm">
                  Saved. Start the preview to apply development settings.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={save.isPending || query.isPending}>
                  Save configuration
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={environment !== "development" || inspect.isPending}
                  title={
                    environment === "development"
                      ? undefined
                      : "Connection tests run against the development configuration."
                  }
                  onClick={() => inspect.mutate()}
                >
                  Test connection and inspect
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </Button>
              </div>
              <p className="text-xs text-fg-muted">
                Install dependencies by starting the preview before inspection. The probe reads
                selected schema metadata, not rows. Disconnecting removes configuration, not your
                database.
              </p>
              {inspection && (
                <pre className="overflow-auto whitespace-pre-wrap text-xs">{inspection}</pre>
              )}
            </form>
          </section>
        </div>
      )}
    </>
  );
}
