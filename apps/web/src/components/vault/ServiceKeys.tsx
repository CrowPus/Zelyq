import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VAULT_KEY_SCOPES, type VaultKeyScope, type VaultServiceKey } from "@zelyq/core";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldOff } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../../lib/api";
import { formatRelative, vaultErrorMessage } from "../../lib/vault";
import { Badge, Button, EmptyState, FieldLabel, IconButton, Input, Spinner } from "../ui";

const SCOPE_TEXT: Record<VaultKeyScope, string> = {
  list: "List names",
  read: "Read values",
  write: "Set values (never Protected ones)",
};

/**
 * Service keys: how a server, a CI job or a cluster outside Zelyq reads this
 * team's Vault. One key per system. A key is shown once, at creation or
 * rotation, and never again — Zelyq keeps only a hash of it.
 */
export function ServiceKeysTab({ teamId, canAdmin }: { teamId: string; canAdmin: boolean }) {
  const cache = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ name: string; secret: string } | null>(null);
  const keys = useQuery({
    queryKey: ["vault-keys", teamId],
    queryFn: () => api.vault.keys(teamId).then((r) => r.keys),
    enabled: canAdmin,
    // "Last used" is how someone setting up a server sees their key work, so
    // it must not sit at "Never used" after the first fetch.
    refetchInterval: 15_000,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["vault-keys", teamId] });

  if (!canAdmin) {
    return (
      <EmptyState
        title="Admins and owners manage service keys"
        description="A service key can read Protected secrets, so creating one is limited to admins and owners of the team."
      />
    );
  }

  return (
    <section aria-label="Service keys">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-2xs text-fg-muted">
          For your own servers, CI and scripts. One key per system; revoke it the moment that system
          no longer needs it.
        </p>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus size={13} strokeWidth={1.75} />}
          onClick={() => {
            setCreating(true);
            setShown(null);
          }}
        >
          New service key
        </Button>
      </div>

      {shown && (
        <ShownOnce
          name={shown.name}
          secret={shown.secret}
          onClose={() => {
            setShown(null);
            void refresh();
          }}
        />
      )}
      {creating && (
        <CreateKey
          teamId={teamId}
          onCreated={async (name, secret) => {
            setCreating(false);
            setShown({ name, secret });
            await refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {keys.isPending && <Spinner className="size-3" />}
      {keys.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(keys.error)}
        </p>
      )}
      {keys.data?.length === 0 && !creating && (
        <EmptyState
          title="No service keys"
          description="Create one to read this Vault from outside Zelyq — a deploy script, a CI job, a Kubernetes cluster."
        />
      )}
      {keys.data && keys.data.length > 0 && (
        <ul className="divide-y divide-border-default rounded-lg border border-border-default">
          {keys.data.map((key) => (
            <KeyRow
              key={key.id}
              teamId={teamId}
              item={key}
              onRotated={async (secret) => {
                setShown({ name: key.name, secret });
                await refresh();
              }}
              onRevoked={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateKey({
  teamId,
  onCreated,
  onCancel,
}: {
  teamId: string;
  onCreated: (name: string, secret: string) => Promise<void>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<VaultKeyScope[]>(["list", "read"]);
  const [patterns, setPatterns] = useState("");
  const [ips, setIps] = useState("");
  const [expires, setExpires] = useState("");
  const split = (text: string) =>
    text
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  const create = useMutation({
    mutationFn: () =>
      api.vault.createKey(teamId, {
        name,
        scopes,
        namePatterns: split(patterns).length ? split(patterns) : null,
        allowedIps: split(ips).length ? split(ips) : null,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      }),
    onSuccess: (created) => onCreated(created.key.name, created.secret),
  });
  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="text-xs font-medium">New service key</p>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-name`}>
          <FieldLabel>Name — which system uses it</FieldLabel>
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Production deploy"
          autoFocus
          required
          maxLength={100}
        />
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1">
          <FieldLabel>It may</FieldLabel>
        </legend>
        {VAULT_KEY_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) =>
                setScopes((current) =>
                  event.target.checked ? [...current, scope] : current.filter((s) => s !== scope),
                )
              }
            />
            {SCOPE_TEXT[scope]}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-patterns`}>
          <FieldLabel>Only these names (optional)</FieldLabel>
        </label>
        <Input
          id={`${ids}-patterns`}
          value={patterns}
          onChange={(event) => setPatterns(event.target.value)}
          placeholder="STRIPE_*, DB_PASSWORD — empty means every secret"
          className="font-mono"
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-ips`}>
          <FieldLabel>Only from these addresses (optional)</FieldLabel>
        </label>
        <Input
          id={`${ids}-ips`}
          value={ips}
          onChange={(event) => setIps(event.target.value)}
          placeholder="203.0.113.10, 198.51.100.0/24 — empty means anywhere"
          className="font-mono"
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${ids}-expires`}>
          <FieldLabel>Expires (optional)</FieldLabel>
        </label>
        <Input
          id={`${ids}-expires`}
          type="date"
          value={expires}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(event) => setExpires(event.target.value)}
        />
      </div>
      {create.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(create.error)}
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
          disabled={!name.trim() || scopes.length === 0 || create.isPending}
        >
          {create.isPending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}

/** The one and only time a key is visible, with how to use it. */
function ShownOnce({
  name,
  secret,
  onClose,
}: {
  name: string;
  secret: string;
  onClose: () => void;
}) {
  const origin = window.location.origin;
  const [example, setExample] = useState<"curl" | "node" | "python">("curl");
  const examples = {
    curl: `curl -H "Authorization: Bearer $ZELYQ_VAULT_KEY" \\\n  ${origin}/api/v1/vault/secrets/STRIPE_KEY_LIVE`,
    node: `const res = await fetch("${origin}/api/v1/vault/secrets/STRIPE_KEY_LIVE", {\n  headers: { Authorization: \`Bearer \${process.env.ZELYQ_VAULT_KEY}\` },\n});\nconst { value } = await res.json();`,
    python: `import os, requests\nvalue = requests.get(\n    "${origin}/api/v1/vault/secrets/STRIPE_KEY_LIVE",\n    headers={"Authorization": f"Bearer {os.environ['ZELYQ_VAULT_KEY']}"},\n).json()["value"]`,
  };
  return (
    <div
      role="status"
      className="mb-4 grid gap-3 rounded-lg border border-success/30 bg-success-subtle p-3"
    >
      <p className="text-xs font-medium">
        Key for “{name}”. Copy it now — it will not be shown again.
      </p>
      <CopyLine value={secret} label="Copy key" />
      <div>
        <div className="mb-1 flex gap-1" role="tablist" aria-label="Example">
          {(["curl", "node", "python"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={example === id}
              onClick={() => setExample(id)}
              className={`rounded px-2 py-0.5 text-2xs ${
                example === id ? "bg-surface text-fg" : "text-fg-secondary"
              }`}
            >
              {id === "curl" ? "curl" : id === "node" ? "Node" : "Python"}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-md bg-surface p-2 text-2xs">
          {examples[example]}
        </pre>
        <p className="mt-1 text-2xs text-fg-muted">
          Give the system the key as <code>ZELYQ_VAULT_KEY</code>; it fetches everything else from
          Vault.
        </p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          I have copied it
        </Button>
      </div>
    </div>
  );
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-default bg-surface px-2 py-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
      <IconButton
        size="sm"
        label={copied ? "Copied" : label}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
      </IconButton>
    </div>
  );
}

function KeyRow({
  teamId,
  item,
  onRotated,
  onRevoked,
}: {
  teamId: string;
  item: VaultServiceKey;
  onRotated: (secret: string) => Promise<void>;
  onRevoked: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const rotate = useMutation({
    mutationFn: () => api.vault.rotateKey(teamId, item.id),
    onSuccess: (created) => onRotated(created.secret),
  });
  const revoke = useMutation({
    mutationFn: () => api.vault.revokeKey(teamId, item.id),
    onSuccess: onRevoked,
  });
  const expired = item.expiresAt !== null && Date.parse(item.expiresAt) <= Date.now();
  const status = item.revokedAt ? "revoked" : expired ? "expired" : "active";
  const error = rotate.error ?? revoke.error;
  return (
    <li className={`px-3 py-2.5 ${status === "active" ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <KeyRound size={13} className="text-fg-muted" />
            <span className="text-sm font-medium">{item.name}</span>
            <code className="text-2xs text-fg-muted">{item.keyPrefix}…</code>
            <Badge tone={status === "active" ? "success" : "danger"}>{status}</Badge>
            {item.scopes.map((scope) => (
              <Badge key={scope}>{scope}</Badge>
            ))}
          </p>
          <p className="mt-0.5 text-2xs text-fg-muted">
            {item.namePatterns ? `Names: ${item.namePatterns.join(", ")}` : "Every secret"}
            {" · "}
            {item.allowedIps ? `From: ${item.allowedIps.join(", ")}` : "From anywhere"}
            {item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString()}` : ""}
          </p>
          <p className="mt-0.5 text-2xs text-fg-muted">
            {item.lastUsedAt
              ? `Last used ${formatRelative(item.lastUsedAt)} from ${item.lastUsedIp}`
              : "Never used"}
            {" · "}created by {item.createdBy?.name ?? "someone"} {formatRelative(item.createdAt)}
          </p>
        </div>
        {status === "active" && (
          <div className="flex shrink-0 gap-0.5">
            <IconButton
              size="sm"
              label={`Rotate ${item.name}`}
              onClick={() => setConfirm("rotate")}
            >
              <RefreshCw size={13} strokeWidth={1.75} />
            </IconButton>
            <IconButton
              size="sm"
              variant="danger"
              label={`Revoke ${item.name}`}
              onClick={() => setConfirm("revoke")}
            >
              <ShieldOff size={13} strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
      </div>
      {confirm && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2 py-1.5 text-xs">
          <span>
            {confirm === "rotate"
              ? `Make a new key for “${item.name}”? The current one stops working at once.`
              : `Revoke “${item.name}”? Anything using it loses access at once.`}
          </span>
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={rotate.isPending || revoke.isPending}
              onClick={() => {
                setConfirm(null);
                (confirm === "rotate" ? rotate : revoke).mutate();
              }}
            >
              {confirm === "rotate" ? "Rotate" : "Revoke"}
            </Button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {vaultErrorMessage(error)}
        </p>
      )}
    </li>
  );
}
