import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingField } from "@zelyq/core";
import { CircleAlert, Lock, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { Badge, Button, IconButton, Input, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

type Draft = Record<string, string | number | boolean>;

/**
 * Everything that can be set through the environment can be set here instead,
 * for people who will never open a terminal. The environment still wins: a
 * field it supplies is shown locked, naming the variable, rather than pretending
 * to be editable.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const users = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (caught) => setError((caught as Error).message),
  });

  const save = useMutation({
    mutationFn: () => api.updateSettings(draft),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      setDraft({});
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const dirty = Object.keys(draft).length > 0;

  if (settings.isLoading) {
    return (
      <AppShell crumbs={[{ label: "Settings" }]}>
        <div className="grid h-full place-items-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (settings.isError) {
    return (
      <AppShell crumbs={[{ label: "Settings" }]}>
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-sm text-fg">{(settings.error as Error).message}</p>
            <p className="mt-1 text-xs text-fg-secondary">
              Only an instance administrator can change settings.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumbs={[{ label: "Settings" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
          <header>
            <h1 className="text-xl font-semibold text-fg">Settings</h1>
            <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
              These can also be set as environment variables. Anything the environment provides is
              shown locked here, because the environment takes precedence.
            </p>
          </header>

          {settings.data?.restartPending && (
            <p className="mt-5 flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-warning">
              <RotateCw size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              Some changes need the server restarted before they take effect.
            </p>
          )}

          {settings.data?.groups.map((group) => (
            <section key={group.name} className="mt-7">
              <h2 className="text-sm font-medium text-fg">{group.name}</h2>
              <p className="mt-0.5 text-xs text-fg-secondary">{group.description}</p>

              <div className="mt-3 divide-y divide-border-default overflow-hidden rounded-lg border border-border-default bg-surface">
                {group.fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    draft={draft}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.key]: value }))
                    }
                  />
                ))}
              </div>
            </section>
          ))}

          <section className="mt-7">
            <h2 className="text-sm font-medium text-fg">Users</h2>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Everyone with an account on this instance, across every team.
            </p>

            <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface">
              {users.isLoading && (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                  <Spinner /> Loading users…
                </div>
              )}
              {users.data?.users.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">
                      {account.name}
                      {account.id === user?.id && (
                        <span className="ml-1.5 text-xs text-fg-muted">(you)</span>
                      )}
                      {account.instanceRole === "admin" && (
                        <span className="ml-1.5 inline-block">
                          <Badge tone="neutral">instance admin</Badge>
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-2xs text-fg-muted">{account.email}</p>
                  </div>
                  <span className="shrink-0 text-2xs text-fg-muted">
                    joined {new Date(account.createdAt).toLocaleDateString()}
                  </span>
                  {account.id !== user?.id && (
                    <IconButton
                      size="sm"
                      variant="danger"
                      label={`Delete ${account.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${account.name} (${account.email})? This removes their account and anything only they could reach. This cannot be undone.`,
                          )
                        ) {
                          deleteUser.mutate(account.id);
                        }
                      }}
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          </section>

          {error && (
            <p className="mt-5 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft({})}>
                Discard
              </Button>
            )}
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <ShieldCheck size={13} strokeWidth={1.75} /> Saved
              </span>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FieldRow({
  field,
  draft,
  onChange,
}: {
  field: SettingField;
  draft: Draft;
  onChange(value: string | number | boolean): void;
}) {
  const pending = draft[field.key];
  const locked = field.managedByEnv;

  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-fg">{field.label}</span>
          {locked && (
            <span
              className="inline-flex items-center gap-1 text-2xs text-fg-muted"
              title={`Set by ${field.envVar} in the environment`}
            >
              <Lock size={10} strokeWidth={2} />
              {field.envVar}
            </span>
          )}
          {field.restartRequired && <Badge tone="neutral">restart</Badge>}
          {field.kind === "secret" && field.configured && (
            <Badge tone="success">{field.hint ?? "set"}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{field.description}</p>
      </div>

      <div className="sm:justify-self-end">
        {locked ? (
          <p className="font-mono text-xs text-fg-muted">
            {field.kind === "secret" ? (field.hint ?? "configured") : String(field.value ?? "")}
          </p>
        ) : field.kind === "select" ? (
          <select
            value={String(pending ?? field.value ?? "")}
            onChange={(event) => onChange(event.target.value)}
            aria-label={field.label}
            className="h-[30px] w-full rounded-md border border-border-default bg-surface px-2 text-sm text-fg"
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.kind === "boolean" ? (
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={Boolean(pending ?? field.value)}
              onChange={(event) => onChange(event.target.checked)}
              className="size-3.5 accent-fg"
            />
            {(pending ?? field.value) ? "Enabled" : "Disabled"}
          </label>
        ) : (
          <>
            <Input
              type={
                field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text"
              }
              value={String(pending ?? (field.kind === "secret" ? "" : (field.value ?? "")))}
              onChange={(event) => onChange(event.target.value)}
              aria-label={field.label}
              autoComplete={field.kind === "secret" ? "new-password" : "off"}
              placeholder={
                field.kind === "secret" && field.configured
                  ? "Enter a new value to replace"
                  : field.placeholder
              }
              list={field.suggestions ? `${field.key}-suggestions` : undefined}
            />
            {field.suggestions && (
              <datalist id={`${field.key}-suggestions`}>
                {field.suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
    </div>
  );
}
