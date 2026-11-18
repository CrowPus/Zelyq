import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackendConfigurationResolved } from "@zelyq/core";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Button, Drawer, Input, NativeSelect, PasswordInput } from "./ui";

export function BackendPanel({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** Opened from the app's menu (the address says `?panel=backend`). */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
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
  });
  const [inspection, setInspection] = useState("");
  useEffect(() => {
    if (query.data) {
      const { configured: _configured, revision: _revision, ...config } = query.data.configuration;
      setForm(config);
      setInspection("");
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api.saveBackend(projectId, form, environment),
    onSuccess: async () => {
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
  const inputClass =
    "w-full rounded-md border border-border-control bg-surface px-2.5 h-8 text-sm text-fg";
  return (
    <Drawer open={open} onOpenChange={onOpenChange} width="lg" title={t("Backend configuration")}>
      <div className="p-5">
        <p className="mb-4 text-sm text-fg-muted">
          {t(
            "Connect your database and identity provider. Existing tables are never changed by connecting or inspecting. Previews use development settings.",
          )}
        </p>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label>
            {t("Environment")}
            <NativeSelect
              className={inputClass}
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as typeof environment)}
            >
              <option value="development">{t("development — used by previews and checks")}</option>
              <option value="test">{t("test — stored, not yet used")}</option>
              <option value="production">{t("production — stored, not yet used")}</option>
            </NativeSelect>
          </label>
          {environment !== "development" && (
            <p role="status" className="text-xs text-fg-muted">
              {t(
                "Saved securely, but nothing reads this environment yet: previews, checks and connection tests all use development. Deployment will use it.",
              )}
            </p>
          )}
          <label>
            {t("Database")}
            <NativeSelect
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
              <option value="none">{t("No database")}</option>
              <option value="postgresql">{t("My PostgreSQL database")}</option>
              <option value="mysql">{t("My MySQL database")}</option>
              <option value="sqlite">{t("SQLite — persistent local file")}</option>
              <option value="supabase">{t("Linked Supabase resource")}</option>
            </NativeSelect>
          </label>
          {["postgresql", "mysql"].includes(form.engine) && (
            <label>
              {t("Connection URL")}
              <PasswordInput
                className={inputClass}
                autoComplete="new-password"
                value={form.databaseUrl ?? ""}
                placeholder={
                  query.data?.configuration.configured
                    ? t("Saved — leave unchanged to keep")
                    : t("{engine}://user:password@host/database", { engine: form.engine })
                }
                onChange={(e) => setForm({ ...form, databaseUrl: e.target.value })}
              />
            </label>
          )}
          <label>
            {t("Schema ownership")}
            <NativeSelect
              className={inputClass}
              value={form.ownership}
              onChange={(e) =>
                setForm({ ...form, ownership: e.target.value as typeof form.ownership })
              }
            >
              <option value="external">{t("Existing schema — managed outside this app")}</option>
              <option value="application">
                {t("Application-owned schema — migrations reviewed separately")}
              </option>
            </NativeSelect>
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={form.readOnly}
              onChange={(e) => setForm({ ...form, readOnly: e.target.checked })}
            />
            {t("Read-only access (use read-only database credentials)")}
          </label>
          <label>
            {t("Schema (optional)")}
            <Input
              className={inputClass}
              value={form.schema ?? ""}
              onChange={(e) => setForm({ ...form, schema: e.target.value || undefined })}
            />
          </label>
          <label>
            {t("Tables to inspect (comma-separated)")}
            <Input
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
            {t("Application authentication")}
            <NativeSelect
              className={inputClass}
              value={form.auth}
              onChange={(e) => setForm({ ...form, auth: e.target.value as typeof form.auth })}
            >
              <option value="none">
                {t("Not configured — protected routes remain unavailable")}
              </option>
              <option value="jwt">{t("Existing provider — signed access tokens")}</option>
            </NativeSelect>
          </label>
          {form.auth === "jwt" &&
            (["issuer", "audience", "jwksUrl"] as const).map((key) => (
              <label key={key}>
                {
                  {
                    issuer: t("Token issuer (HTTPS)"),
                    audience: t("API audience"),
                    jwksUrl: t("Signing keys URL (HTTPS)"),
                  }[key]
                }
                <Input
                  className={inputClass}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value || undefined })}
                />
              </label>
            ))}
          <p className="text-sm text-fg-muted">
            {t(
              "API keys and other secrets for the backend are set under {strong}, next to this button — typed there, or taken from your team’s Vault. They reach the backend as environment variables.",
              { strong: <strong>{t("Variables")}</strong> },
            )}
          </p>
          {(query.error || save.error || inspect.error || disconnect.error) && (
            <p role="alert" className="text-sm text-danger">
              {String(query.error || save.error || inspect.error || disconnect.error)}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm">
              {t("Saved. Start the preview to apply development settings.")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending || query.isPending}>
              {t("Save configuration")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={environment !== "development" || inspect.isPending}
              title={
                environment === "development"
                  ? undefined
                  : t("Connection tests run against the development configuration.")
              }
              onClick={() => inspect.mutate()}
            >
              {t("Test connection and inspect")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {t("Disconnect")}
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            {t(
              "Install dependencies by starting the preview before inspection. The probe reads selected schema metadata, not rows. Disconnecting removes configuration, not your database.",
            )}
          </p>
          {inspection && (
            <pre className="overflow-auto whitespace-pre-wrap text-xs">{inspection}</pre>
          )}
        </form>
      </div>
    </Drawer>
  );
}
