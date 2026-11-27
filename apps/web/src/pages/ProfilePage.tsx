import { useQueryClient } from "@tanstack/react-query";
import { type AccountService, accountServiceLinks } from "@zelyq/core";
import { CircleAlert, ExternalLink, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { PreferencesCard } from "../components/account/Preferences";
import { SessionsCard, TwoFactorCard } from "../components/account/Security";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageBody,
  PageHeader,
  PasswordInput,
  Tabs,
} from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { roleName } from "../lib/roles";

export function ProfilePage() {
  const { user, teams, session, refresh } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: "profile" | "security" | "preferences" =
    raw === "security" || raw === "preferences" ? raw : "profile";

  if (!user) return null;
  // Managed: a person's email, password and account live with the account
  // service. The server's own administrators keep their local account here.
  const accounts = user.instanceRole === "admin" ? null : (session?.accounts ?? null);

  return (
    <AppShell crumbs={[{ label: t("Account") }]} scope="global">
      <PageBody width="narrow">
        <PageHeader
          title={t("Account")}
          description={
            accounts
              ? t(
                  "Your details, devices and preferences. Your email, password and account are managed at {name}.",
                  { name: accounts.name },
                )
              : t("Your details, how you sign in, and how Zelyq looks for you.")
          }
          tabs={
            <Tabs
              label={t("Account")}
              value={tab}
              onChange={(next) =>
                setParams(next === "profile" ? {} : { tab: next }, { replace: true })
              }
              items={[
                { id: "profile", label: t("Profile"), icon: <UserRound size={14} /> },
                { id: "security", label: t("Security"), icon: <ShieldCheck size={14} /> },
                {
                  id: "preferences",
                  label: t("Preferences"),
                  icon: <SlidersHorizontal size={14} />,
                },
              ]}
            />
          }
        />

        {tab === "profile" && (
          <>
            {accounts ? (
              <ManagedProfileSection user={user} accounts={accounts} />
            ) : (
              <ProfileSection
                user={user}
                onSaved={() => {
                  refresh();
                  queryClient.invalidateQueries({ queryKey: ["session"] });
                }}
              />
            )}

            <Card
              title={t("Membership")}
              description={t("Your role on this server, and in each of your teams.")}
              padded={false}
              className="mt-6"
            >
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3 last:border-b-0">
                  <span className="text-sm text-fg">{t("Server role")}</span>
                  <Badge tone={user.instanceRole === "admin" ? "info" : "neutral"}>
                    {user.instanceRole}
                  </Badge>
                </div>
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3 last:border-b-0"
                  >
                    <span className="truncate text-sm text-fg">{team.name}</span>
                    <Badge tone="neutral">{roleName(team.role)}</Badge>
                  </div>
                ))}
              </div>
            </Card>

            {!accounts && <DeleteAccountSection />}
          </>
        )}

        {tab === "security" && (
          <div className="flex flex-col gap-6">
            {accounts ? (
              <Card title={t("Password and two-factor sign-in")}>
                <p className="text-sm text-fg-secondary">
                  {t("Your password and two-factor sign-in are managed at {name}.", {
                    name: accounts.name,
                  })}
                </p>
                <a
                  href={accountServiceLinks(accounts).account()}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-info underline-offset-2 hover:underline"
                >
                  {t("Manage your account at {name}", { name: accounts.name })}
                  <ExternalLink size={12} aria-hidden />
                </a>
              </Card>
            ) : (
              <>
                <PasswordSection />
                <TwoFactorCard />
              </>
            )}
            <SessionsCard />
          </div>
        )}

        {tab === "preferences" && <PreferencesCard />}
      </PageBody>
    </AppShell>
  );
}

/**
 * Deleting your own account. Irreversible, and it takes any project only you
 * could reach with it — so it asks for the password and makes you type the
 * word, rather than putting a one-click button next to "change your name".
 */
function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      // Nothing left to return to: reload onto the sign-in screen.
      window.location.assign("/");
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-danger/40">
      <header className="border-b border-danger/25 bg-danger-subtle px-4 py-3">
        <h3 className="text-sm font-semibold text-danger">{t("Danger zone")}</h3>
      </header>
      <div className="bg-surface p-4">
        <p className="text-sm font-medium text-fg">{t("Delete your account")}</p>
        <p className="mt-0.5 text-sm text-fg-secondary">
          {t(
            "This cannot be undone. Any team where you are the only member is deleted too, along with its projects and their files on disk. You will be refused if you are the last owner of a team that still has members, or the last administrator of this instance.",
          )}
        </p>

        {open ? (
          <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
            <label htmlFor="delete-password" className="text-sm font-medium text-fg">
              {t("Your password")}
            </label>
            <PasswordInput
              id="delete-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <label htmlFor="delete-confirm" className="text-sm font-medium text-fg">
              {t("Type {part} to confirm", {
                part: <span className="font-mono text-fg">delete</span>,
              })}
            </label>
            <Input
              id="delete-confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
            />
            {error && <Feedback state={{ error }} />}
            <div className="mt-1 flex items-center gap-2">
              <Button
                type="submit"
                variant="danger"
                disabled={busy || confirm !== "delete" || !password}
              >
                {busy ? t("Deleting…") : t("Delete my account")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("Cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
            {t("Delete account…")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Managed mode: shown, not edited here; changes are made at the account service. */
function ManagedProfileSection({
  user,
  accounts,
}: {
  user: { name: string; email: string };
  accounts: AccountService;
}) {
  return (
    <Card title={t("Profile")} padded={false}>
      <div>
        <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3">
          <span className="text-xs text-fg-secondary">{t("Name")}</span>
          <span className="truncate text-sm text-fg">{user.name}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3">
          <span className="text-xs text-fg-secondary">{t("Email")}</span>
          <span className="truncate text-sm text-fg">{user.email}</span>
        </div>
        <div className="px-4 py-3">
          <a
            href={accountServiceLinks(accounts).account()}
            className="inline-flex items-center gap-1.5 text-xs text-info underline-offset-2 hover:underline"
          >
            {t("Manage your account at {name}", { name: accounts.name })}
            <ExternalLink size={12} aria-hidden />
          </a>
          <p className="mt-1 text-xs text-fg-muted">
            {t("Change your name, email or password, or delete your account, there.")}
          </p>
        </div>
      </div>
    </Card>
  );
}

function ProfileSection({
  user,
  onSaved,
}: {
  user: { name: string; email: string };
  onSaved(): void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ error?: string; saved?: boolean; busy?: boolean }>({});

  const emailChanged = email.trim().toLowerCase() !== user.email;
  const dirty = name.trim() !== user.name || emailChanged;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    try {
      await api.updateProfile({
        name: name.trim(),
        email: email.trim(),
        ...(emailChanged ? { currentPassword: password } : {}),
      });
      setPassword("");
      setState({ saved: true });
      onSaved();
      setTimeout(() => setState({}), 2500);
    } catch (caught) {
      setState({ error: (caught as Error).message });
    }
  }

  return (
    <Card title={t("Profile")} description={t("Your name, and the email you sign in with.")}>
      <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-name" className="text-sm font-medium text-fg">
            {t("Name")}
          </label>
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-email" className="text-sm font-medium text-fg">
            {t("Email")}
          </label>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </div>

        {/*
          Only asked for when the email actually changes: an open session on a
          shared machine should not be enough to move the account to an address
          its owner does not control.
        */}
        {emailChanged && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="profile-confirm" className="text-sm font-medium text-fg">
              {t("Current password")}
            </label>
            <PasswordInput
              id="profile-confirm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder={t("Required to change your email")}
            />
          </div>
        )}

        <Feedback state={state} />

        <div>
          <Button type="submit" variant="primary" disabled={!dirty} loading={state.busy}>
            {t("Save profile")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<{ error?: string; saved?: boolean; busy?: boolean }>({});

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 10 && next === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true });
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setState({ saved: true });
      setTimeout(() => setState({}), 4000);
    } catch (caught) {
      setState({ error: (caught as Error).message });
    }
  }

  return (
    <Card
      title={t("Password")}
      description={t("At least 10 characters. Changing it signs every other device out.")}
    >
      <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
        <Field label={t("Current password")}>
          <PasswordInput
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label={t("New password")}>
          <PasswordInput
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={10}
          />
        </Field>
        <Field
          label={t("Confirm new password")}
          error={mismatch ? t("The two entries do not match.") : undefined}
        >
          <PasswordInput
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <Feedback
          state={state}
          savedMessage={t("Password changed. Other devices were signed out.")}
        />

        <div>
          <Button type="submit" variant="primary" disabled={!ready} loading={state.busy}>
            {t("Change password")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Feedback({
  state,
  savedMessage = "Saved",
}: {
  state: { error?: string; saved?: boolean };
  savedMessage?: string;
}) {
  if (state.error) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
        <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.saved) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success">
        <ShieldCheck size={13} strokeWidth={1.75} /> {savedMessage}
      </p>
    );
  }
  return null;
}
