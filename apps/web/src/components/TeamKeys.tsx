import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { teamHref } from "../lib/routes";
import { Badge, Button, confirmAction, NativeSelect, PasswordInput, Spinner } from "./ui";

/**
 * The team's own AI keys. Each team brings its own: they are used first for
 * everything the team does (its apps' chat, Ops, voice, Studio), kept
 * encrypted in the team's Vault, and never shown again.
 */
export function TeamKeys({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  // A key is pasted, or taken from a secret already in the team's Vault (by name).
  const [from, setFrom] = useState<"paste" | "vault">("paste");
  const [vaultName, setVaultName] = useState("");
  const choices = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }).then((r) => r.choices),
    enabled: editing !== null && from === "vault",
  });
  const usable = choices.data?.filter((choice) => choice.selectable) ?? [];
  const [error, setError] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ["team-keys", teamId], queryFn: () => api.teamKeys(teamId) });

  const done = (data: Awaited<ReturnType<typeof api.teamKeys>>) => {
    queryClient.setQueryData(["team-keys", teamId], data);
    // What the team can use changed: the model list and Studio ask again.
    for (const key of ["providers", "image-capabilities", "video-capabilities"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    setEditing(null);
    setValue("");
    setError(null);
  };
  const save = useMutation({
    mutationFn: (provider: string) =>
      from === "vault"
        ? api.teamKeyFromVault(teamId, provider, vaultName)
        : api.setTeamKey(teamId, provider, value),
    onSuccess: done,
    onError: (caught) => setError((caught as Error).message),
  });
  const remove = useMutation({
    mutationFn: (provider: string) => api.removeTeamKey(teamId, provider),
    onSuccess: done,
    onError: (caught) => setError((caught as Error).message),
  });

  if (keys.isLoading) return <Spinner />;
  const data = keys.data;
  if (!data) return null;
  const none = data.keys.every((key) => key.source === "none");

  return (
    <section className="mt-8" aria-label={t("AI keys")}>
      <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
        {t("AI keys")}
      </h2>
      <p className="mt-1 text-xs text-fg-secondary">
        {data.usesServerKeys
          ? t(
              "This team may use the server’s keys. A key of its own is used first, and paid by the team. Keys are kept encrypted in the team’s Vault and never shown again.",
            )
          : t(
              "This team pays for its own AI. Add at least one key (Claude or Gemini) to build apps; Gemini also powers Ops and voice. Keys are kept encrypted in the team’s Vault and never shown again.",
            )}
      </p>
      {none && (
        <p className="mt-2 rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-fg">
          {canManage
            ? t("No AI key yet: the team’s apps cannot be built until you add one below.")
            : t("No AI key yet: the team’s apps cannot be built until a team admin adds one here.")}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <ul className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
        {data.keys.map((key) => (
          <li
            key={key.provider}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-default px-4 py-2.5 last:border-b-0"
          >
            <KeyRound size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
            <span className="w-28 shrink-0 text-sm text-fg">{key.label}</span>
            <span className="min-w-0 flex-1">
              {key.vaultName ? (
                <Badge tone={key.vaultMissing ? "danger" : "info"}>
                  {key.vaultMissing
                    ? t("Vault: {vaultName} (missing)", { vaultName: key.vaultName })
                    : t("Vault: {vaultName}", { vaultName: key.vaultName })}
                </Badge>
              ) : key.source === "team" ? (
                <Badge tone="success">{t("Team’s own key")}</Badge>
              ) : key.source === "server" ? (
                <Badge tone="neutral">{t("Server’s key")}</Badge>
              ) : (
                <span className="text-xs text-fg-muted">{t("No key")}</span>
              )}
            </span>
            {canManage && editing !== key.provider && (
              <span className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(key.provider);
                    setValue("");
                    setFrom(key.vaultName ? "vault" : "paste");
                    setVaultName(key.vaultName ?? "");
                    setError(null);
                  }}
                >
                  {key.source === "team" || key.vaultName ? t("Change") : t("Add key")}
                </Button>
                {(key.source === "team" || key.vaultName) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: t("Remove the team’s {label} key?", { label: key.label }),
                          confirmLabel: t("Remove key"),
                          danger: true,
                        })
                      )
                        remove.mutate(key.provider);
                    }}
                  >
                    {t("Remove")}
                  </Button>
                )}
              </span>
            )}
            {editing === key.provider && (
              <form
                className="flex w-full flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (from === "vault" ? vaultName : value.trim()) save.mutate(key.provider);
                }}
              >
                <div className="flex w-full gap-1 rounded-md bg-canvas p-0.5 text-2xs">
                  {(
                    [
                      ["paste", t("Paste key")],
                      ["vault", t("From Vault")],
                    ] as const
                  ).map(([choice, label]) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={from === choice}
                      onClick={() => setFrom(choice)}
                      className={`flex-1 rounded px-2 py-1 font-medium ${
                        from === choice
                          ? "bg-surface text-fg shadow-sm"
                          : "text-fg-muted hover:text-fg"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {from === "vault" ? (
                  choices.isPending ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-2xs text-fg-secondary">
                      <Spinner /> {t("Reading the team’s Vault…")}
                    </span>
                  ) : usable.length === 0 ? (
                    <span className="min-w-0 flex-1 text-2xs text-fg-secondary">
                      {t(
                        "The team’s Vault has no secret to choose yet. {link}, then choose it here.",
                        {
                          link: (
                            <Link
                              to={teamHref(`/vault?scope=${teamId}`)}
                              className="underline underline-offset-2"
                            >
                              {t("Add the key to the Vault")}
                            </Link>
                          ),
                        },
                      )}
                    </span>
                  ) : (
                    <NativeSelect
                      aria-label={t("{label} key from Vault", { label: key.label })}
                      value={vaultName}
                      onChange={(event) => setVaultName(event.target.value)}
                      className="min-w-0 flex-1"
                    >
                      <option value="">{t("Choose the secret holding the key…")}</option>
                      {usable.map((choice) => (
                        <option key={choice.name} value={choice.name}>
                          {choice.name}
                          {choice.protected ? t(" · Protected") : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  )
                ) : (
                  <PasswordInput
                    aria-label={t("{label} API key", { label: key.label })}
                    placeholder={t("Paste the key")}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    autoComplete="off"
                    className="min-w-0 flex-1"
                  />
                )}
                <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
                  {save.isPending ? t("Saving…") : t("Save")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {t("Cancel")}
                </Button>
                <span className="w-full text-2xs text-fg-muted">
                  {from === "vault"
                    ? t(
                        "Only the secret’s name is kept; its value is read when the key is used and never shown.",
                      )
                    : t("Get one at {hint}.", { hint: key.hint })}
                </span>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
