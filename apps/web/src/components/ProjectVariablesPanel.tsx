import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectVariable } from "@zelyq/core";
import {
  Eye,
  EyeOff,
  History,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { teamHref, useTeamPaths } from "../lib/routes";
import { formatRelative, vaultErrorMessage } from "../lib/vault";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  NativeSelect,
  PasswordInput,
  Spinner,
} from "./ui";
import { ImportForm, RevealedValue, VersionHistory } from "./vault/shared";

type Form =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; variable: ProjectVariable }
  | { mode: "import" };

/**
 * What this project's app is given. Every variable is either typed here or
 * taken from the team's Vault — the person's choice, per variable. Values are
 * write-only: the only way to see one is Reveal, which the server records.
 */
export function ProjectVariablesPanel({
  projectId,
  teamId,
  canEdit,
  hasBackend,
  open,
  onOpenChange,
}: {
  projectId: string;
  teamId: string;
  canEdit: boolean;
  /** Whether this project runs server code that receives the variables. */
  hasBackend: boolean;
  /** Opened from the app's sidebar (the address says `?panel=variables`). */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [form, setForm] = useState<Form>({ mode: "closed" });
  const cache = useQueryClient();
  const vaultPath = `${useTeamPaths().vault}?scope=${teamId}`;
  const variables = useQuery({
    queryKey: ["variables", projectId],
    queryFn: () => api.variables.list(projectId).then((r) => r.variables),
    enabled: open,
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["variables", projectId] });
    // The server stopped the preview: what it was started with is stale.
    await cache.invalidateQueries({ queryKey: ["preview", projectId] });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={t("Variables")}
      description={t(
        "What this app is given, encrypted. Type a value, or take one from your team’s {link}. Never sent to the browser or to the agent.",
        {
          link: (
            <Link
              to={vaultPath}
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              {t("Vault")}
            </Link>
          ),
        },
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-2.5">
          <p className="text-2xs text-fg-muted">
            {hasBackend
              ? t("The backend receives these when the preview runs. A change restarts it.")
              : t(
                  "This app has no server of its own yet, so nothing reads these until it has one. Browser code never gets them.",
                )}
          </p>
          {canEdit && (
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
                {t("Add variable")}
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {(form.mode === "add" || form.mode === "edit") && (
            <VariableForm
              key={form.mode === "edit" ? form.variable.id : "add"}
              projectId={projectId}
              teamId={teamId}
              editing={form.mode === "edit" ? form.variable : null}
              onDone={async () => {
                setForm({ mode: "closed" });
                await refresh();
              }}
              onCancel={() => setForm({ mode: "closed" })}
            />
          )}
          {form.mode === "import" && (
            <ImportForm
              title={t("Import into this app")}
              run={(input) => api.variables.import(projectId, input)}
              onImported={refresh}
              onClose={() => setForm({ mode: "closed" })}
            />
          )}
          {variables.isPending && (
            <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <Spinner className="size-3" /> {t("Loading…")}
            </p>
          )}
          {variables.isError && (
            <p role="alert" className="text-xs text-danger">
              {vaultErrorMessage(variables.error)}
            </p>
          )}
          {variables.data?.length === 0 && form.mode === "closed" && (
            <EmptyState
              title={t("No variables")}
              description={
                canEdit
                  ? t(
                      "Add the keys this app needs: type a value, or pick one from your team’s Vault.",
                    )
                  : t("An editor of this app can add them.")
              }
            />
          )}
          <SupabaseSync projectId={projectId} canEdit={canEdit} />
          {variables.data && variables.data.length > 0 && (
            <ul className="divide-y divide-border-default rounded-lg border border-border-default">
              {variables.data.map((variable) => (
                <VariableRow
                  key={`${variable.id}:${variable.version}`}
                  projectId={projectId}
                  variable={variable}
                  canEdit={canEdit}
                  onEdit={() => setForm({ mode: "edit", variable })}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function VariableForm({
  projectId,
  teamId,
  editing,
  onDone,
  onCancel,
}: {
  projectId: string;
  teamId: string;
  editing: ProjectVariable | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [source, setSource] = useState<"direct" | "vault">(editing?.source ?? "direct");
  const [value, setValue] = useState("");
  const [vaultName, setVaultName] = useState(editing?.vaultName ?? "");
  const choices = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }).then((r) => r.choices),
    enabled: source === "vault",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return api.variables.update(
          projectId,
          editing.id,
          source === "vault" ? { vaultName } : { value },
        );
      }
      return api.variables.create(
        projectId,
        source === "vault" ? { name, vaultName } : { name, value },
      );
    },
    onSuccess: onDone,
  });
  const ready =
    (editing || name) &&
    (source === "vault"
      ? vaultName && !(editing?.source === "vault" && editing.vaultName === vaultName)
      : value);

  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-xs font-medium">
        {editing ? t("Change {name}", { name: editing.name }) : t("New variable")}
      </p>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-name`}>
          <FieldLabel>{t("Name the app reads")}</FieldLabel>
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          placeholder="STRIPE_KEY"
          className="font-mono"
          disabled={editing !== null}
          autoFocus={editing === null}
          required
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1">
          <FieldLabel>{t("Value")}</FieldLabel>
        </legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name={`${ids}-source`}
            checked={source === "direct"}
            onChange={() => setSource("direct")}
          />
          {t("Type a value")}
        </label>
        {source === "direct" && (
          <PasswordInput
            aria-label={t("Value")}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={editing?.source === "direct" ? t("New value") : t("The secret")}
            autoComplete="new-password"
            spellCheck={false}
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name={`${ids}-source`}
            checked={source === "vault"}
            onChange={() => setSource("vault")}
          />
          {t("From Vault")}
        </label>
        {source === "vault" && (
          <>
            <NativeSelect
              aria-label={t("Vault secret")}
              className="font-mono"
              value={vaultName}
              onChange={(event) => setVaultName(event.target.value)}
            >
              <option value="">{choices.isPending ? t("Loading…") : t("Choose a secret…")}</option>
              {choices.data?.map((choice) => (
                <option key={choice.name} value={choice.name} disabled={!choice.selectable}>
                  {choice.name}
                  {choice.protected ? t(" (Protected — admins and owners)") : ""}
                </option>
              ))}
            </NativeSelect>
            {choices.data?.length === 0 && (
              <p className="text-2xs text-fg-muted">
                {t("Your team’s Vault is empty. {link}.", {
                  link: (
                    <Link
                      to={teamHref(`/vault?scope=${teamId}`)}
                      className="underline underline-offset-2"
                    >
                      {t("Add a secret there")}
                    </Link>
                  ),
                })}
              </p>
            )}
          </>
        )}
      </fieldset>
      {save.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={save.isPending || !ready}>
          {save.isPending ? t("Saving…") : editing ? t("Save") : t("Add")}
        </Button>
      </div>
    </form>
  );
}

function VariableRow({
  projectId,
  variable,
  canEdit,
  onEdit,
  onChanged,
}: {
  projectId: string;
  variable: ProjectVariable;
  canEdit: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reveal = useMutation({
    mutationFn: () => api.variables.reveal(projectId, variable.id),
    onSuccess: ({ value }) => setRevealed(value),
  });
  const remove = useMutation({
    mutationFn: () => api.variables.remove(projectId, variable.id),
    onSuccess: onChanged,
  });
  const error = reveal.error ?? remove.error;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{variable.name}</span>
            {variable.source === "vault" ? (
              <Badge tone="info">
                <KeyRound size={10} className="mr-1" />{" "}
                {t("Vault: {vaultName}", { vaultName: variable.vaultName })}
              </Badge>
            ) : (
              <Badge>{t("Typed")}</Badge>
            )}
            {variable.protected && (
              <Badge tone="warning">
                <LockKeyhole size={10} className="mr-1" /> {t("Protected")}
              </Badge>
            )}
          </p>
          {variable.missing && (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert">
              <TriangleAlert size={12} />{" "}
              {t("{vaultName} is no longer in Vault. The app does not get this variable.", {
                vaultName: variable.vaultName,
              })}
            </p>
          )}
          <p className="mt-0.5 text-2xs text-fg-muted">
            {t("Changed by {name} · {updatedAt}", {
              name: variable.updatedBy?.name ?? variable.createdBy?.name ?? "Zelyq",
              updatedAt: formatRelative(variable.updatedAt),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit &&
            !variable.missing &&
            (revealed === null ? (
              <IconButton
                size="sm"
                label={t("Reveal {name}", { name: variable.name })}
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
            label={t("History of typed values")}
            aria-pressed={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            <History size={13} strokeWidth={1.75} />
          </IconButton>
          {canEdit && (
            <>
              <IconButton
                size="sm"
                label={t("Change {name}", { name: variable.name })}
                onClick={onEdit}
              >
                <Pencil size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                label={t("Delete {name}", { name: variable.name })}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {revealed !== null && <RevealedValue value={revealed} onHide={() => setRevealed(null)} />}
      {confirmDelete && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2 py-1.5 text-xs">
          <span>
            {variable.source === "vault"
              ? t("Delete {name}? The app will no longer get it. The secret stays in Vault.", {
                  name: <span className="font-mono">{variable.name}</span>,
                })
              : t("Delete {name}? The app will no longer get it.", {
                  name: <span className="font-mono">{variable.name}</span>,
                })}
          </span>
          <span className="flex gap-1">
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
          queryKey={["variable-versions", projectId, variable.id, variable.version]}
          load={() => api.variables.versions(projectId, variable.id).then((r) => r.versions)}
          restore={(version) => api.variables.rollback(projectId, variable.id, version)}
          canRestore={canEdit}
          onRestored={onChanged}
          note={t(
            "Typed values only; a Vault secret keeps its history in Vault. Restoring makes the variable typed again with that value.",
          )}
        />
      )}
    </li>
  );
}

/**
 * For an app linked to Supabase: its Edge Functions get these variables as
 * function secrets, kept in step after every change. Shown only when linked.
 */
function SupabaseSync({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ["variables-functions", projectId],
    queryFn: () => api.variables.functions(projectId).then((r) => r.status),
  });
  const sync = useMutation({
    mutationFn: () => api.variables.syncFunctions(projectId),
    onSuccess: ({ status: next }) => cache.setQueryData(["variables-functions", projectId], next),
  });
  const data = status.data;
  if (!data?.linked) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-xs">
      <span>
        <span className="font-medium">{t("Supabase Edge Functions")}</span>{" "}
        {data.error ? (
          <span className="text-danger" role="alert">
            {t("— last sync failed: {error}", { error: data.error })}
          </span>
        ) : data.at ? (
          <span className="text-fg-secondary">
            {t(
              "— {nameCount, plural, one {# variable} other {# variables}} set {at}. Read them with {code}.",
              {
                nameCount: data.names.length,
                at: formatRelative(data.at),
                code: <code>Deno.env.get("NAME")</code>,
              },
            )}
          </span>
        ) : (
          <span className="text-fg-secondary">{t("— not synced yet.")}</span>
        )}
      </span>
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={12} strokeWidth={1.75} />}
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
        >
          {sync.isPending ? t("Syncing…") : t("Sync now")}
        </Button>
      )}
    </div>
  );
}
