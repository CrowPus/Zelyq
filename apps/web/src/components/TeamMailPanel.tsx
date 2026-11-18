import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { api, type TeamMailInput } from "../lib/api";
import { t } from "../lib/i18n";
import { type SecretFrom, SecretSource } from "./SecretSource";
import { Button, confirmAction, FieldLabel, Input, NativeSelect, Spinner } from "./ui";

/**
 * The team's own email (Team settings → Email): its invitations and Ops's
 * messages go out through its own mail server. Any member sees it (never the
 * password); a team admin sets it, tests it or removes it.
 */
export function TeamMailPanel({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ["team-mail", teamId],
    queryFn: () => api.teamMail(teamId),
  });
  const mail = current.data?.mail ?? null;
  const empty: TeamMailInput = {
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    from: "",
  };
  const [form, setForm] = useState<TeamMailInput>(empty);
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState<SecretFrom>("type");
  const [vaultName, setVaultName] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (mail) {
      const { passwordSet: _set, passwordVault, ...rest } = mail;
      setForm(rest);
      setFrom(passwordVault ? "vault" : "type");
      setVaultName(passwordVault ?? "");
    }
  }, [mail]);

  const done = (text: string) => {
    void queryClient.invalidateQueries({ queryKey: ["team-mail", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["team-invites", teamId] });
    setNotice({ ok: true, text });
  };
  const failed = (caught: unknown) => setNotice({ ok: false, text: (caught as Error).message });

  const save = useMutation({
    mutationFn: () =>
      api.saveTeamMail(teamId, {
        ...form,
        ...(from === "vault" && vaultName ? { passwordVault: vaultName } : {}),
        ...(from === "type" && password ? { password } : {}),
      }),
    onSuccess: () => {
      setPassword("");
      setEditing(false);
      done("Saved. Send yourself a test to be sure it works.");
    },
    onError: failed,
  });
  const test = useMutation({
    mutationFn: () => api.testTeamMail(teamId),
    onSuccess: (result) =>
      setNotice({ ok: true, text: t("Sent to {to}. Check that it arrived.", { to: result.to }) }),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: () => api.removeTeamMail(teamId),
    onSuccess: () => {
      setForm(empty);
      setEditing(false);
      done("Removed. The team sends no email of its own now.");
    },
    onError: failed,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    save.mutate();
  }

  const set = (patch: Partial<TeamMailInput>) => setForm((f) => ({ ...f, ...patch }));
  const showForm = canManage && (editing || !mail);

  return (
    <section className="mt-8" id="email" aria-label={t("Email")}>
      <h2 className="flex items-center gap-2 text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
        <Mail size={13} aria-hidden /> {t("Email")}
      </h2>
      <p className="mt-1 text-xs text-fg-secondary">
        {t(
          "The team’s own mail server. Invitations to the team and Ops’s messages (plans waiting for approval, alerts) go out through it, from your own address. Without one, an invitation gives a link to copy, and Ops’s messages still reach the bell and the team’s chats.",
        )}
      </p>

      {current.isLoading && (
        <div className="mt-3">
          <Spinner />
        </div>
      )}

      {mail && !editing && (
        <div className="mt-3 rounded-md border border-border-default bg-surface-subtle p-3 text-sm">
          <p className="text-fg">
            {t("Sending as {strong}", { strong: <strong>{mail.from}</strong> })}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {mail.host}:{mail.port} ·{" "}
            {mail.security === "tls"
              ? "TLS"
              : mail.security === "starttls"
                ? "STARTTLS"
                : t("no encryption")}
            {mail.username ? t(" · signs in as {username}", { username: mail.username }) : ""}
            {mail.passwordVault
              ? t(" · password from Vault: {passwordVault}", { passwordVault: mail.passwordVault })
              : mail.passwordSet
                ? t(" · password saved")
                : ""}
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? <Spinner /> : null}
                {t("Send a test")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t("Change")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirmAction({
                      title: t("Remove the team’s mail server?"),
                      confirmLabel: t("Remove"),
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                {t("Remove")}
              </Button>
            </div>
          )}
        </div>
      )}

      {!mail && !current.isLoading && !canManage && (
        <p className="mt-3 text-xs text-fg-muted">
          {t("No mail server yet. A team admin can add one.")}
        </p>
      )}

      {showForm && !current.isLoading && (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="team-mail-from">
              <FieldLabel>{t("Sent as")}</FieldLabel>
            </label>
            <Input
              id="team-mail-from"
              value={form.from}
              required
              placeholder="Acme <hello@acme.com>"
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="team-mail-host">
              <FieldLabel>{t("Mail server")}</FieldLabel>
            </label>
            <Input
              id="team-mail-host"
              value={form.host}
              required
              placeholder="smtp.example.com"
              onChange={(e) => set({ host: e.target.value.trim() })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="team-mail-port">
                <FieldLabel>{t("Port")}</FieldLabel>
              </label>
              <Input
                id="team-mail-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set({ port: Number(e.target.value) || 587 })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="team-mail-security">
                <FieldLabel>{t("Security")}</FieldLabel>
              </label>
              <NativeSelect
                id="team-mail-security"
                value={form.security}
                onChange={(e) => set({ security: e.target.value as TeamMailInput["security"] })}
              >
                <option value="starttls">{t("STARTTLS (587)")}</option>
                <option value="tls">{t("TLS (465)")}</option>
                <option value="none">{t("None")}</option>
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="team-mail-username">
              <FieldLabel>{t("Username")}</FieldLabel>
            </label>
            <Input
              id="team-mail-username"
              value={form.username}
              autoComplete="off"
              placeholder="hello@acme.com"
              onChange={(e) => set({ username: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="team-mail-password">
              <FieldLabel>{t("Password")}</FieldLabel>
            </label>
            <SecretSource
              id="team-mail-password"
              teamId={teamId}
              label={t("Mail server password")}
              placeholder={
                mail?.passwordSet && !mail.passwordVault ? t("Saved: type to replace") : ""
              }
              from={from}
              onFrom={setFrom}
              value={password}
              onValue={setPassword}
              vaultName={vaultName}
              onVaultName={setVaultName}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {t("Save")}
            </Button>
            {mail && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("Cancel")}
              </Button>
            )}
          </div>
        </form>
      )}

      {notice && (
        <p className={`mt-2 text-xs ${notice.ok ? "text-success" : "text-danger"}`}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
