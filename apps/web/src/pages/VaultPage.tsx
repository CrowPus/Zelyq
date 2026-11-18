import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { roleAtLeast, type VaultEntry, type VaultScope } from "@zelyq/core";
import {
  Eye,
  EyeOff,
  History,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  NativeSelect,
  PageBody,
  PageHeader,
  PasswordInput,
  Spinner,
  Tabs,
} from "../components/ui";
import { ServiceKeysTab } from "../components/vault/ServiceKeys";
import { ImportForm, RevealedValue, VersionHistory } from "../components/vault/shared";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../lib/audit";
import { t } from "../lib/i18n";
import { formatRelative, vaultErrorMessage } from "../lib/vault";

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
                  { id: "secrets", label: t("Secrets") },
                  { id: "keys", label: t("Service keys"), hidden: scope.kind !== "team" },
                  { id: "activity", label: t("Activity") },
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
        <ul className="divide-y divide-border-default rounded-lg border border-border-default">
          {secrets.data.map((secret) => (
            <SecretRow
              // Keyed by version too: a new value is a fresh row, so a value
              // revealed before the change is not left showing.
              key={`${secret.id}:${secret.version}`}
              scope={scope}
              secret={secret}
              canWrite={canWrite}
              canAdmin={canAdmin}
              onEdit={() => setForm({ mode: "edit", secret })}
              onChanged={refresh}
            />
          ))}
        </ul>
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

function SecretRow({
  scope,
  secret,
  canWrite,
  canAdmin,
  onEdit,
  onChanged,
}: {
  scope: VaultScope;
  secret: VaultEntry;
  canWrite: boolean;
  canAdmin: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mayUse = secret.protected ? canAdmin : canWrite;

  const reveal = useMutation({
    mutationFn: () => api.vault.reveal(scope, secret.id),
    onSuccess: ({ value }) => setRevealed(value),
  });
  const remove = useMutation({
    mutationFn: () => api.vault.remove(scope, secret.id),
    onSuccess: onChanged,
  });
  const changedBy = secret.updatedBy?.name ?? secret.createdBy?.name ?? "Zelyq";
  const error = reveal.error ?? remove.error;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{secret.name}</span>
            <Badge>v{secret.version}</Badge>
            {secret.protected && (
              <Badge tone="warning">
                <LockKeyhole size={10} className="mr-1" /> {t("Protected")}
              </Badge>
            )}
          </p>
          {secret.description && (
            <p className="mt-0.5 truncate text-xs text-fg-secondary">{secret.description}</p>
          )}
          <p className="mt-0.5 text-2xs text-fg-muted">
            {secret.usedBy.length === 0
              ? t("Not used anywhere yet · changed by {changedBy} · {updatedAt}", {
                  changedBy,
                  updatedAt: formatRelative(secret.updatedAt),
                })
              : t("Used by {value} · changed by {changedBy} · {updatedAt}", {
                  value: secret.usedBy
                    .map((use) =>
                      use.kind === "project" ? `${use.projectName} (${use.variable})` : use.label,
                    )
                    .join(", "),
                  changedBy,
                  updatedAt: formatRelative(secret.updatedAt),
                })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {mayUse &&
            (revealed === null ? (
              <IconButton
                size="sm"
                label={t("Reveal {name}", { name: secret.name })}
                onClick={() => reveal.mutate()}
                disabled={reveal.isPending}
              >
                <Eye size={13} strokeWidth={1.75} />
              </IconButton>
            ) : (
              <IconButton size="sm" label={t("Hide value")} onClick={() => setRevealed(null)}>
                <EyeOff size={13} strokeWidth={1.75} />
              </IconButton>
            ))}
          <IconButton
            size="sm"
            label={t("History")}
            aria-pressed={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            <History size={13} strokeWidth={1.75} />
          </IconButton>
          {mayUse && (
            <IconButton
              size="sm"
              label={t("Change {name}", { name: secret.name })}
              onClick={onEdit}
            >
              <Pencil size={13} strokeWidth={1.75} />
            </IconButton>
          )}
          {canAdmin && (
            <IconButton
              size="sm"
              variant="danger"
              label={t("Delete {name}", { name: secret.name })}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>

      {revealed !== null && <RevealedValue value={revealed} onHide={() => setRevealed(null)} />}

      {confirmDelete && (
        <div className="mt-2 grid gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2 py-1.5 text-xs">
          <span>
            {t("Delete {name} and its history?", {
              name: <span className="font-mono">{secret.name}</span>,
            })}
            {secret.usedBy.length > 0 ? (
              <>
                {t(" These will lose it:")}
                <ul className="mt-1 list-disc pl-5">
                  {secret.usedBy.map((use) => (
                    <li key={use.kind === "project" ? `${use.projectId}:${use.variable}` : use.key}>
                      {use.kind === "project"
                        ? t("{projectName} — variable {variable}", {
                            projectName: use.projectName,
                            variable: use.variable,
                          })
                        : `Settings — ${use.label}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              t(" Nothing uses it.")
            )}
          </span>
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("Keep")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {t("Delete")}
            </Button>
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {vaultErrorMessage(error)}
        </p>
      )}

      {showHistory && (
        <VersionHistory
          queryKey={["vault-versions", scopeKey(scope), secret.id, secret.version]}
          load={() => api.vault.versions(scope, secret.id).then((r) => r.versions)}
          restore={(version) => api.vault.rollback(scope, secret.id, version)}
          canRestore={mayUse}
          onRestored={onChanged}
          note="Restoring saves that value again as a new version, so nothing is lost. Everything using this secret gets it."
        />
      )}
    </li>
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
  return (
    <ul className="divide-y divide-border-default rounded-lg border border-border-default">
      {activity.data.map((entry) => {
        const summary = auditDetailSummary(entry.detail);
        return (
          <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <span className="flex items-start gap-2">
              {entry.action === "vault.secret.fetched" ? (
                <ShieldCheck size={13} className="mt-0.5 text-fg-muted" />
              ) : (
                <KeyRound size={13} className="mt-0.5 text-fg-muted" />
              )}
              <span>
                <span className="font-medium">{entry.actorName}</span>{" "}
                {AUDIT_ACTION_LABELS[entry.action]}
                {summary && <span className="font-mono text-fg-secondary"> · {summary}</span>}
              </span>
            </span>
            <span className="shrink-0 text-fg-muted">{formatRelative(entry.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
