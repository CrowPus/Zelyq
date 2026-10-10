import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  VAULT_ENVIRONMENTS,
  type VaultEnvironment,
  type VaultImportResult,
  type VaultSecret,
} from "@zelyq/core";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "../lib/api";
import { ENVIRONMENT_NOTES, REVEAL_SECONDS, vaultErrorMessage } from "../lib/vault";
import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  IconButton,
  Input,
  PasswordInput,
  Spinner,
  Textarea,
} from "./ui";

type Form =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; secret: VaultSecret }
  | { mode: "import" };

/**
 * A project's secrets. Values are write-only here as on the server: the only
 * way to see one is Reveal, which the server records, and which hides itself
 * again after half a minute so a value is not left on a screen someone walks
 * away from.
 *
 * Viewers see the list and its history; editors add, change, reveal, restore
 * and delete — the same rule the server enforces, mirrored so nobody is
 * offered a button that can only refuse.
 */
export function VaultPanel({
  projectId,
  canEdit,
  hasBackend,
}: {
  projectId: string;
  canEdit: boolean;
  /** Whether anything in this project reads the values yet. */
  hasBackend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState<VaultEnvironment>("development");
  const [form, setForm] = useState<Form>({ mode: "closed" });
  const cache = useQueryClient();

  const secrets = useQuery({
    queryKey: ["vault", projectId, environment],
    queryFn: () => api.listVaultSecrets(projectId, environment).then((r) => r.secrets),
    enabled: open,
  });

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["vault", projectId] });
    // Development values are what the preview runs with; the server has
    // stopped it, so the preview's status is stale too.
    if (environment === "development") {
      await cache.invalidateQueries({ queryKey: ["preview", projectId] });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<KeyRound size={13} strokeWidth={1.75} />}
        onClick={() => setOpen(true)}
        className="max-md:px-1.5"
        // On a phone the word is hidden and only the key shows; the button
        // still needs a name.
        aria-label="Vault"
        title="Vault: this project's secrets"
      >
        <span className="max-md:hidden">Vault</span>
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Vault"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-default bg-overlay text-fg shadow-overlay"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border-default p-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <KeyRound size={16} strokeWidth={1.75} /> Vault
                </h2>
                <p className="mt-1 text-xs text-fg-secondary">
                  This project's secrets, encrypted. They reach the app as environment variables and
                  are never sent to the browser or to the agent.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </header>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-2.5">
              <div
                role="tablist"
                aria-label="Environment"
                className="flex items-center gap-0.5 rounded-md border border-border-default bg-surface-subtle p-0.5"
              >
                {VAULT_ENVIRONMENTS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={environment === name}
                    onClick={() => {
                      setEnvironment(name);
                      // A form for one environment must not be submitted into another.
                      setForm({ mode: "closed" });
                    }}
                    className={`h-6 rounded px-2 text-xs capitalize transition-colors ${
                      environment === name
                        ? "bg-surface text-fg shadow-sm"
                        : "text-fg-secondary hover:text-fg"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
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
                    Add secret
                  </Button>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <p className="mb-3 text-2xs text-fg-muted" role="note">
                {ENVIRONMENT_NOTES[environment]}
                {environment === "development" && !hasBackend && (
                  <>
                    {" "}
                    This project has no backend yet, so nothing reads these values until it has one.
                  </>
                )}
              </p>

              {(form.mode === "add" || form.mode === "edit") && (
                <SecretForm
                  key={form.mode === "edit" ? form.secret.id : "add"}
                  projectId={projectId}
                  environment={environment}
                  editing={form.mode === "edit" ? form.secret : null}
                  onDone={async () => {
                    setForm({ mode: "closed" });
                    await refresh();
                  }}
                  onCancel={() => setForm({ mode: "closed" })}
                />
              )}
              {form.mode === "import" && (
                <ImportForm
                  projectId={projectId}
                  environment={environment}
                  onImported={refresh}
                  onClose={() => setForm({ mode: "closed" })}
                />
              )}

              {secrets.isPending && (
                <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
                  <Spinner className="size-3" /> Loading secrets…
                </p>
              )}
              {secrets.isError && (
                <p role="alert" className="text-xs text-danger">
                  {vaultErrorMessage(secrets.error)}
                </p>
              )}
              {secrets.data?.length === 0 && form.mode === "closed" && (
                <EmptyState
                  title={`No ${environment} secrets`}
                  description={
                    canEdit
                      ? "Add API keys and passwords your app needs, or import an existing .env file."
                      : "An editor of this project can add them."
                  }
                />
              )}
              {secrets.data && secrets.data.length > 0 && (
                <ul className="divide-y divide-border-default rounded-lg border border-border-default">
                  {secrets.data.map((secret) => (
                    <SecretRow
                      // Keyed by version too: a new value is a fresh row, so a
                      // value revealed before the change is not left showing.
                      key={`${secret.id}:${secret.version}`}
                      projectId={projectId}
                      secret={secret}
                      canEdit={canEdit}
                      onEdit={() => setForm({ mode: "edit", secret })}
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

function SecretForm({
  projectId,
  environment,
  editing,
  onDone,
  onCancel,
}: {
  projectId: string;
  environment: VaultEnvironment;
  editing: VaultSecret | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState(editing?.description ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = description.trim() || null;
      if (editing) {
        return api.updateVaultSecret(projectId, editing.id, {
          ...(value ? { value } : {}),
          ...(trimmed !== editing.description ? { description: trimmed } : {}),
        });
      }
      return api.createVaultSecret(projectId, {
        name,
        environment,
        value,
        ...(trimmed ? { description: trimmed } : {}),
      });
    },
    onSuccess: onDone,
  });

  const unchanged =
    editing !== null && !value && (description.trim() || null) === editing.description;

  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-xs font-medium">
        {editing ? `Change ${editing.name}` : `New ${environment} secret`}
      </p>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-name`}>
          <FieldLabel>Name</FieldLabel>
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          placeholder="STRIPE_SECRET_KEY"
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
          <FieldLabel>Value</FieldLabel>
        </label>
        <PasswordInput
          id={`${ids}-value`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={editing ? "New value (leave empty to keep the current one)" : "The secret"}
          autoComplete="new-password"
          autoFocus={editing !== null}
          required={editing === null}
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-description`}>
          <FieldLabel>Description (optional)</FieldLabel>
        </label>
        <Input
          id={`${ids}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What it is for"
          maxLength={500}
        />
      </div>
      {save.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={save.isPending || unchanged || (!editing && (!name || !value))}
        >
          {save.isPending ? "Saving…" : editing ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}

function ImportForm({
  projectId,
  environment,
  onImported,
  onClose,
}: {
  projectId: string;
  environment: VaultEnvironment;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<VaultImportResult | null>(null);

  const run = useMutation({
    mutationFn: () => api.importVault(projectId, { environment, content, overwrite }),
    onSuccess: async ({ result }) => {
      setResult(result);
      setContent("");
      await onImported();
    },
  });

  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        run.mutate();
      }}
    >
      <p className="text-xs font-medium">Import into {environment}</p>
      <Textarea
        rows={6}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={"STRIPE_SECRET_KEY=sk_live_…\nOPENAI_API_KEY=sk-…"}
        className="font-mono text-xs"
        spellCheck={false}
        aria-label=".env content"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          Replace secrets that already exist
        </label>
        <label className="cursor-pointer text-xs text-fg-secondary underline-offset-2 hover:underline">
          Or choose a file
          <input
            type="file"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setContent(await file.text());
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {run.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(run.error)}
        </p>
      )}
      {result && (
        <div role="status" className="grid gap-1 text-xs">
          {result.created.length > 0 && <p>Added: {result.created.join(", ")}</p>}
          {result.updated.length > 0 && <p>Replaced: {result.updated.join(", ")}</p>}
          {result.skipped.length > 0 && (
            <ul className="text-fg-secondary">
              {result.skipped.map((item) => (
                <li key={item.name}>
                  Skipped <span className="font-mono">{item.name}</span>: {item.reason}
                </li>
              ))}
            </ul>
          )}
          {result.created.length + result.updated.length === 0 && <p>Nothing was imported.</p>}
        </div>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {result ? "Done" : "Cancel"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!content.trim() || run.isPending}
        >
          {run.isPending ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}

function SecretRow({
  projectId,
  secret,
  canEdit,
  onEdit,
  onChanged,
}: {
  projectId: string;
  secret: VaultSecret;
  canEdit: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Hide again on its own; also forget the value if the secret changes under us.
  useEffect(() => {
    if (revealed === null) return;
    const timer = setTimeout(() => setRevealed(null), REVEAL_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [revealed]);

  const reveal = useMutation({
    mutationFn: () => api.revealVaultSecret(projectId, secret.id),
    onSuccess: ({ value }) => setRevealed(value),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteVaultSecret(projectId, secret.id),
    onSuccess: onChanged,
  });

  const changedBy = secret.updatedBy?.name ?? secret.createdBy?.name ?? "Zelyq";
  const error = reveal.error ?? remove.error;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate font-mono text-sm">{secret.name}</span>
            <Badge>v{secret.version}</Badge>
          </p>
          {secret.description && (
            <p className="mt-0.5 truncate text-xs text-fg-secondary">{secret.description}</p>
          )}
          <p className="mt-0.5 text-2xs text-fg-muted">
            Changed by {changedBy} · {formatRelative(secret.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit &&
            (revealed === null ? (
              <IconButton
                size="sm"
                label={`Reveal ${secret.name}`}
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
            label="History"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            <History size={13} strokeWidth={1.75} />
          </IconButton>
          {canEdit && (
            <>
              <IconButton size="sm" label={`Change ${secret.name}`} onClick={onEdit}>
                <Pencil size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                label={`Delete ${secret.name}`}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {revealed !== null && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border-default bg-surface-subtle px-2 py-1.5">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{revealed}</code>
          <IconButton
            size="sm"
            label={copied ? "Copied" : "Copy value"}
            onClick={async () => {
              await navigator.clipboard.writeText(revealed);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <Check size={13} strokeWidth={1.75} />
            ) : (
              <Copy size={13} strokeWidth={1.75} />
            )}
          </IconButton>
          <span className="text-2xs text-fg-muted">hides in {REVEAL_SECONDS}s</span>
        </div>
      )}

      {confirmDelete && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2 py-1.5 text-xs">
          <span>
            Delete <span className="font-mono">{secret.name}</span> and its history? An app that
            reads it will no longer find it.
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
          projectId={projectId}
          secret={secret}
          canEdit={canEdit}
          onRestored={onChanged}
        />
      )}
    </li>
  );
}

function VersionHistory({
  projectId,
  secret,
  canEdit,
  onRestored,
}: {
  projectId: string;
  secret: VaultSecret;
  canEdit: boolean;
  onRestored: () => Promise<void>;
}) {
  const versions = useQuery({
    queryKey: ["vault-versions", projectId, secret.id, secret.version],
    queryFn: () => api.vaultSecretVersions(projectId, secret.id).then((r) => r.versions),
  });
  const restore = useMutation({
    mutationFn: (version: number) => api.rollbackVaultSecret(projectId, secret.id, version),
    onSuccess: onRestored,
  });

  return (
    <div className="mt-2 rounded-md border border-border-default bg-surface-subtle p-2">
      {versions.isPending && <Spinner className="size-3" />}
      {versions.data && (
        <ol className="grid gap-1">
          {versions.data.map((version) => (
            <li key={version.version} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-mono">v{version.version}</span>
                <span className="text-fg-muted">
                  {" "}
                  · {version.createdBy?.name ?? "Zelyq"} · {formatRelative(version.createdAt)}
                </span>
              </span>
              {version.current ? (
                <Badge tone="success">current</Badge>
              ) : (
                canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => restore.mutate(version.version)}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                )
              )}
            </li>
          ))}
        </ol>
      )}
      {restore.isError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {vaultErrorMessage(restore.error)}
        </p>
      )}
      <p className="mt-1.5 text-2xs text-fg-muted">
        Restoring saves that value again as a new version, so nothing is lost.
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
