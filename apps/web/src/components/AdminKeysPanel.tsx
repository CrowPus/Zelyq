import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_SCOPES, type AdminScope, ALL_ADMIN_SCOPES } from "@zelyq/core";
import { Check, CircleAlert, Copy, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { Badge, Button, confirmAction, IconButton, Input, Spinner } from "./ui";

/**
 * Admin API keys: how an outside system (an account service, monitoring,
 * analytics, support tools) runs this server through `/api/admin/v1`. Each key
 * reaches only the scopes ticked when it was made, and is shown once.
 */
export function AdminKeysPanel() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["admin-keys"], queryFn: api.adminKeys });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<AdminScope>>(new Set());
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createAdminKey({ name: name.trim(), scopes: [...scopes] }),
    onSuccess: (created) => {
      setFresh({ name: created.summary.name, key: created.key });
      setName("");
      setScopes(new Set());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-keys"] });
    },
    onError: (caught) => setError((caught as Error).message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeAdminKey(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-keys"] }),
    onError: (caught) => setError((caught as Error).message),
  });

  const toggle = (scope: AdminScope) =>
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="mt-7">
      <h2 className="text-sm font-medium text-fg">API keys</h2>
      <p className="mt-1 text-xs text-fg-secondary">
        For your own systems that run this server: an account service, monitoring, analytics or
        support tools. They call <code className="font-mono">/api/admin/v1</code> with{" "}
        <code className="font-mono">Authorization: Bearer zlq_admin_…</code>. Give each system its
        own key with only what it needs. Every change a key makes is in the audit log under its
        name.
      </p>

      {fresh && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success-subtle p-3">
          <p className="text-xs font-medium text-fg">
            “{fresh.name}” is ready. Copy the key now: it is not shown again.
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border-default bg-surface px-2 py-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{fresh.key}</code>
            <IconButton
              size="sm"
              label={copied ? "Copied" : "Copy key"}
              onClick={async () => {
                await navigator.clipboard.writeText(fresh.key);
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
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFresh(null)}>
            I have stored it
          </Button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="mt-4 space-y-3 rounded-lg border border-border-default bg-surface p-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-key-name" className="text-xs font-medium text-fg-secondary">
            Name
          </label>
          <Input
            id="admin-key-name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="Account service"
          />
        </div>
        <fieldset>
          <div className="flex items-baseline justify-between">
            <legend className="text-xs font-medium text-fg-secondary">What it may reach</legend>
            <button
              type="button"
              className="text-xs text-info underline-offset-2 hover:underline"
              onClick={() =>
                setScopes(
                  scopes.size === ALL_ADMIN_SCOPES.length ? new Set() : new Set(ALL_ADMIN_SCOPES),
                )
              }
            >
              {scopes.size === ALL_ADMIN_SCOPES.length ? "None" : "All"}
            </button>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ALL_ADMIN_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={scopes.has(scope)}
                  onChange={() => toggle(scope)}
                />
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-fg">{scope}</span>
                  <span className="block text-2xs text-fg-muted">{ADMIN_SCOPES[scope]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          icon={<KeyRound size={13} />}
          disabled={!name.trim() || scopes.size === 0 || create.isPending}
        >
          {create.isPending ? "Making…" : "Make key"}
        </Button>
      </form>

      <div className="mt-4">
        {keys.isLoading ? (
          <Spinner />
        ) : (keys.data?.keys ?? []).length === 0 ? (
          <p className="text-xs text-fg-muted">No keys yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border-default bg-surface">
            {keys.data?.keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border-default px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg">{key.name}</span>
                    <code className="font-mono text-2xs text-fg-muted">{key.prefix}…</code>
                    {key.revokedAt && <Badge tone="danger">revoked</Badge>}
                  </div>
                  <p className="mt-0.5 text-2xs text-fg-muted">
                    {key.scopes.join(", ")} · made {formatDate(key.createdAt)} ·{" "}
                    {key.lastUsedAt
                      ? `last used ${formatDateTime(key.lastUsedAt)}${key.lastUsedIp ? ` from ${key.lastUsedIp}` : ""}`
                      : "never used"}
                  </p>
                </div>
                {!key.revokedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: `Revoke “${key.name}”?`,
                          description: `It stops working at once.`,
                          confirmLabel: "Revoke key",
                          danger: true,
                        })
                      ) {
                        revoke.mutate(key.id);
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
