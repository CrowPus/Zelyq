import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectVariable } from "@zelyq/core";
import {
  Braces,
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
import { formatRelative, vaultErrorMessage } from "../lib/vault";
import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
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
}: {
  projectId: string;
  teamId: string;
  canEdit: boolean;
  /** Whether this project runs server code that receives the variables. */
  hasBackend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>({ mode: "closed" });
  const cache = useQueryClient();
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
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Braces size={13} strokeWidth={1.75} />}
        onClick={() => setOpen(true)}
        className="max-md:px-1.5"
        // On a phone the word is hidden and only the icon shows; the button
        // still needs a name.
        aria-label="Variables"
        title="Variables: what this app is given"
      >
        <span className="max-md:hidden">Variables</span>
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Variables"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-default bg-overlay text-fg shadow-overlay"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border-default p-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Braces size={16} strokeWidth={1.75} /> Variables
                </h2>
                <p className="mt-1 text-xs text-fg-secondary">
                  What this app is given, encrypted. Type a value, or take one from your team's{" "}
                  <Link to={`/vault?scope=${teamId}`} className="underline underline-offset-2">
                    Vault
                  </Link>
                  . Never sent to the browser or to the agent.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </header>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-2.5">
              <p className="text-2xs text-fg-muted">
                {hasBackend
                  ? "The backend receives these when the preview runs. A change restarts it."
                  : "This app has no server of its own yet, so nothing reads these until it has one. Browser code never gets them."}
              </p>
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Upload size={13} strokeWidth={1.75} />}
                    onClick={() => setForm({ mode: "import" })}
                  >
                    Import .env
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Plus size={13} strokeWidth={1.75} />}
                    onClick={() => setForm({ mode: "add" })}
                  >
                    Add variable
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
                  title="Import into this app"
                  run={(input) => api.variables.import(projectId, input)}
                  onImported={refresh}
                  onClose={() => setForm({ mode: "closed" })}
                />
              )}
              {variables.isPending && (
                <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
                  <Spinner className="size-3" /> Loading…
                </p>
              )}
              {variables.isError && (
                <p role="alert" className="text-xs text-danger">
                  {vaultErrorMessage(variables.error)}
                </p>
              )}
              {variables.data?.length === 0 && form.mode === "closed" && (
                <EmptyState
                  title="No variables"
                  description={
                    canEdit
                      ? "Add the keys this app needs: type a value, or pick one from your team's Vault."
                      : "An editor of this app can add them."
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
          </section>
        </div>
      )}
    </>
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
      <p className="text-xs font-medium">{editing ? `Change ${editing.name}` : "New variable"}</p>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-name`}>
          <FieldLabel>Name the app reads</FieldLabel>
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
          <FieldLabel>Value</FieldLabel>
        </legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name={`${ids}-source`}
            checked={source === "direct"}
            onChange={() => setSource("direct")}
          />
          Type a value
        </label>
        {source === "direct" && (
          <PasswordInput
            aria-label="Value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={editing?.source === "direct" ? "New value" : "The secret"}
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
          From Vault
        </label>
        {source === "vault" && (
          <>
            <select
              aria-label="Vault secret"
              className="h-[30px] rounded-md border border-border-default bg-surface px-2 font-mono text-sm"
              value={vaultName}
              onChange={(event) => setVaultName(event.target.value)}
            >
              <option value="">{choices.isPending ? "Loading…" : "Choose a secret…"}</option>
              {choices.data?.map((choice) => (
                <option key={choice.name} value={choice.name} disabled={!choice.selectable}>
                  {choice.name}
                  {choice.protected ? " (Protected — admins and owners)" : ""}
                </option>
              ))}
            </select>
            {choices.data?.length === 0 && (
              <p className="text-2xs text-fg-muted">
                Your team's Vault is empty.{" "}
                <Link to={`/vault?scope=${teamId}`} className="underline underline-offset-2">
                  Add a secret there
                </Link>
                .
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
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={save.isPending || !ready}>
          {save.isPending ? "Saving…" : editing ? "Save" : "Add"}
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
                <KeyRound size={10} className="mr-1" /> Vault: {variable.vaultName}
              </Badge>
            ) : (
              <Badge>Typed</Badge>
            )}
            {variable.protected && (
              <Badge tone="warning">
                <LockKeyhole size={10} className="mr-1" /> Protected
              </Badge>
            )}
          </p>
          {variable.missing && (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert">
              <TriangleAlert size={12} /> {variable.vaultName} is no longer in Vault. The app does
              not get this variable.
            </p>
          )}
          <p className="mt-0.5 text-2xs text-fg-muted">
            Changed by {variable.updatedBy?.name ?? variable.createdBy?.name ?? "Zelyq"} ·{" "}
            {formatRelative(variable.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit &&
            !variable.missing &&
            (revealed === null ? (
              <IconButton
                size="sm"
                label={`Reveal ${variable.name}`}
                onClick={() => reveal.mutate()}
                disabled={reveal.isPending}
              >
                <Eye size={13} strokeWidth={1.75} />
              </IconButton>
            ) : (
              <IconButton size="sm" label="Hide value" onClick={() => setRevealed(null)}>
                <EyeOff size={13} strokeWidth={1.75} />
              </IconButton>
            ))}
          <IconButton
            size="sm"
            label="History of typed values"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            <History size={13} strokeWidth={1.75} />
          </IconButton>
          {canEdit && (
            <>
              <IconButton size="sm" label={`Change ${variable.name}`} onClick={onEdit}>
                <Pencil size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                label={`Delete ${variable.name}`}
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
            Delete <span className="font-mono">{variable.name}</span>? The app will no longer get
            it.{variable.source === "vault" ? " The secret stays in Vault." : ""}
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              Delete
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
          note="Typed values only; a Vault secret keeps its history in Vault. Restoring makes the variable typed again with that value."
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
        <span className="font-medium">Supabase Edge Functions</span>{" "}
        {data.error ? (
          <span className="text-danger" role="alert">
            — last sync failed: {data.error}
          </span>
        ) : data.at ? (
          <span className="text-fg-secondary">
            — {data.names.length} variable{data.names.length === 1 ? "" : "s"} set{" "}
            {formatRelative(data.at)}. Read them with <code>Deno.env.get("NAME")</code>.
          </span>
        ) : (
          <span className="text-fg-secondary">— not synced yet.</span>
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
          {sync.isPending ? "Syncing…" : "Sync now"}
        </Button>
      )}
    </div>
  );
}
