import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast, type VaultEntry, type VaultScope } from "@zelyq/core";
import { History, Key, KeyRound, Plus, Upload } from "lucide-react";
import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  Button,
  EmptyState,
  FieldLabel,
  Input,
  NativeSelect,
  PageBody,
  PageHeader,
  PasswordInput,
  Spinner,
  Tabs,
} from "../components/ui";
import { SecretsTable, VaultActivityTable } from "../components/vault/SecretsTable";
import { ServiceKeysTab } from "../components/vault/ServiceKeys";
import { ImportForm } from "../components/vault/shared";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { vaultErrorMessage } from "../lib/vault";

type Tab = "secrets" | "keys" | "activity";

/**
 * Vault — a module of its own. A team's secrets live here once and are used
 * from anywhere: a project's variables, Settings, and outside systems through
 * service keys. Administrators also see the instance Vault, which holds keys
 * for Zelyq itself.
 *
 * Which Vault and which tab are in the URL, so a link or a reload lands on the
 * same place.
 */
export function VaultPage() {
  const { user, teams } = useSession();
  const { team: activeTeam } = useActiveTeam();
  const [params, setParams] = useSearchParams();
  const isInstanceAdmin = user?.instanceRole === "admin";

  // A link may name a Vault; otherwise it is the team chosen in the sidebar.
  const requested = params.get("scope") ?? "";
  const team = teams.find((t) => t.id === requested) ?? activeTeam;
  const scope: VaultScope | null =
    requested === "instance" && isInstanceAdmin
      ? { kind: "instance" }
      : team
        ? { kind: "team", teamId: team.id }
        : null;
  const role = scope?.kind === "team" ? team?.role : undefined;
  const canWrite =
    scope?.kind === "instance" || (role !== undefined && roleAtLeast(role, "editor"));
  const canAdmin = scope?.kind === "instance" || (role !== undefined && roleAtLeast(role, "admin"));

  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "keys" && scope?.kind === "team"
      ? "keys"
      : tabParam === "activity"
        ? "activity"
        : "secrets";
  const go = (next: { scope?: string; tab?: Tab }) => {
    const merged = new URLSearchParams(params);
    if (next.scope !== undefined) merged.set("scope", next.scope);
    if (next.tab !== undefined) merged.set("tab", next.tab);
    setParams(merged, { replace: true });
  };

  return (
    <AppShell crumbs={[{ label: t("Vault") }]}>
      <PageBody width="standard">
        <PageHeader
          title={t("Vault")}
          description={t(
            "Keep a credential here once, encrypted, and use it anywhere: in an app’s Variables, in settings, or from your own servers with a service key.",
          )}
          actions={
            (teams.length > 1 || isInstanceAdmin) && (
              <label className="flex items-center gap-2 text-sm text-fg-secondary">
                {t("Showing")}
                <NativeSelect
                  aria-label={t("Vault of")}
                  value={scope?.kind === "instance" ? "instance" : (team?.id ?? "")}
                  onChange={(event) => go({ scope: event.target.value, tab: "secrets" })}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  {isInstanceAdmin && (
                    <option value="instance">{t("Instance — Zelyq’s own keys")}</option>
                  )}
                </NativeSelect>
              </label>
            )
          }
        />

        {!scope ? (
          <EmptyState
            title={t("No team yet")}
            description={t("Join or create a team to use Vault.")}
          />
        ) : (
          <>
            <div className="mb-6">
              <Tabs
                label={t("Vault sections")}
                value={tab}
                onChange={(id) => go({ tab: id })}
                items={[
                  { id: "secrets", label: t("Secrets"), icon: <KeyRound size={14} /> },
                  {
                    id: "keys",
                    label: t("Service keys"),
                    icon: <Key size={14} />,
                    hidden: scope.kind !== "team",
                  },
                  { id: "activity", label: t("Activity"), icon: <History size={14} /> },
                ]}
              />
            </div>
            {tab === "secrets" && (
              <SecretsTab
                key={scopeKey(scope)}
                scope={scope}
                canWrite={canWrite}
                canAdmin={canAdmin}
              />
            )}
            {tab === "keys" && scope.kind === "team" && (
              <ServiceKeysTab key={scope.teamId} teamId={scope.teamId} canAdmin={canAdmin} />
            )}
            {tab === "activity" && <ActivityTab key={scopeKey(scope)} scope={scope} />}
          </>
        )}
      </PageBody>
    </AppShell>
  );
}

function scopeKey(scope: VaultScope): string {
  return scope.kind === "instance" ? "instance" : scope.teamId;
}

type Form =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; secret: VaultEntry }
  | { mode: "import" };

function SecretsTab({
  scope,
  canWrite,
  canAdmin,
}: {
  scope: VaultScope;
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const [form, setForm] = useState<Form>({ mode: "closed" });
  const cache = useQueryClient();
  const secrets = useQuery({
    queryKey: ["vault", scopeKey(scope)],
    queryFn: () => api.vault.list(scope).then((r) => r.secrets),
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["vault", scopeKey(scope)] });

  return (
    <section aria-label={t("Secrets")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-fg-muted">
          {scope.kind === "instance"
            ? t("Keys for Zelyq itself. Choose one on a Settings field with From Vault.")
            : t("Visible to everyone in the team; values only to those allowed to reveal them.")}
        </p>
        {canWrite && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<Upload size={13} strokeWidth={1.75} />}
              onClick={() => setForm({ mode: "import" })}
            >
              {t("Import .env")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={13} strokeWidth={1.75} />}
              onClick={() => setForm({ mode: "add" })}
            >
              {t("Add secret")}
            </Button>
          </div>
        )}
      </div>

      {(form.mode === "add" || form.mode === "edit") && (
        <SecretForm
          key={form.mode === "edit" ? form.secret.id : "add"}
          scope={scope}
          editing={form.mode === "edit" ? form.secret : null}
          canAdmin={canAdmin}
          onDone={async () => {
            setForm({ mode: "closed" });
            await refresh();
          }}
          onCancel={() => setForm({ mode: "closed" })}
        />
      )}
      {form.mode === "import" && (
        <ImportForm
          title={t("Import into Vault")}
          run={(input) => api.vault.import(scope, input)}
          onImported={refresh}
          onClose={() => setForm({ mode: "closed" })}
        />
      )}

      {secrets.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <Spinner className="size-3" /> {t("Loading…")}
        </p>
      )}
      {secrets.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(secrets.error)}
        </p>
      )}
      {secrets.data?.length === 0 && form.mode === "closed" && (
        <EmptyState
          title={t("Vault is empty")}
          description={
            canWrite
              ? t(
                  "Add the API keys and passwords you want to keep in one place, or import an existing .env file once.",
                )
              : t("An editor of this team can add them.")
          }
        />
      )}
      {secrets.data && secrets.data.length > 0 && (
        <SecretsTable
          scope={scope}
          secrets={secrets.data}
          canWrite={canWrite}
          canAdmin={canAdmin}
          onEdit={(secret) => setForm({ mode: "edit", secret })}
          onChanged={refresh}
        />
      )}
    </section>
  );
}

function SecretForm({
  scope,
  editing,
  canAdmin,
  onDone,
  onCancel,
}: {
  scope: VaultScope;
  editing: VaultEntry | null;
  canAdmin: boolean;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [isProtected, setProtected] = useState(editing?.protected ?? false);
  const save = useMutation({
    mutationFn: async () => {
      const note = description.trim() || null;
      if (editing) {
        return api.vault.update(scope, editing.id, {
          ...(value ? { value } : {}),
          ...(note !== editing.description ? { description: note } : {}),
          ...(isProtected !== editing.protected ? { protected: isProtected } : {}),
        });
      }
      return api.vault.create(scope, {
        name,
        value,
        ...(note ? { description: note } : {}),
        ...(isProtected ? { protected: true } : {}),
      });
    },
    onSuccess: onDone,
  });
  const unchanged =
    editing !== null &&
    !value &&
    (description.trim() || null) === editing.description &&
    isProtected === editing.protected;

  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-xs font-medium">
        {editing ? t("Change {name}", { name: editing.name }) : t("New secret")}
      </p>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-name`}>
          <FieldLabel>{t("Name")}</FieldLabel>
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="STRIPE_KEY_LIVE"
          className="font-mono"
          disabled={editing !== null}
          autoFocus={editing === null}
          required
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-value`}>
          <FieldLabel>{t("Value")}</FieldLabel>
        </label>
        <PasswordInput
          id={`${ids}-value`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            editing ? t("New value (leave empty to keep the current one)") : t("The secret")
          }
          autoComplete="new-password"
          autoFocus={editing !== null}
          required={editing === null}
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-description`}>
          <FieldLabel>{t("Description (optional)")}</FieldLabel>
        </label>
        <Input
          id={`${ids}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("What it is for")}
          maxLength={500}
        />
      </div>
      {scope.kind === "team" && (
        <label
          className={`flex items-start gap-2 text-xs ${canAdmin ? "" : "text-fg-muted"}`}
          title={canAdmin ? undefined : t("Only an admin or owner can change this.")}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={isProtected}
            disabled={!canAdmin}
            onChange={(event) => setProtected(event.target.checked)}
          />
          <span>
            {t(
              "{part} — only admins and owners can reveal it, change it, or use it in an app. For live keys.",
              { part: <span className="font-medium">{t("Protected")}</span> },
            )}
          </span>
        </label>
      )}
      {save.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={save.isPending || unchanged || (!editing && (!name || !value))}
        >
          {save.isPending ? t("Saving…") : editing ? t("Save") : t("Add")}
        </Button>
      </div>
    </form>
  );
}

function ActivityTab({ scope }: { scope: VaultScope }) {
  const activity = useQuery({
    queryKey: ["vault-activity", scopeKey(scope)],
    queryFn: () => api.vault.activity(scope).then((r) => r.entries),
  });
  if (activity.isPending) return <Spinner className="size-3" />;
  if (activity.isError)
    return (
      <p role="alert" className="text-xs text-danger">
        {vaultErrorMessage(activity.error)}
      </p>
    );
  if (activity.data.length === 0)
    return (
      <EmptyState
        title={t("Nothing yet")}
        description={t("Changes, reveals and fetches appear here.")}
      />
    );
  return <VaultActivityTable entries={activity.data} />;
}
