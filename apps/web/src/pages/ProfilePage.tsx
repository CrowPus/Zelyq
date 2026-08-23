import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Input, PasswordInput } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

export function ProfilePage() {
  const { user, teams, refresh } = useSession();
  const queryClient = useQueryClient();

  if (!user) return null;

  return (
    <AppShell crumbs={[{ label: "Account" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
          <header>
            <h1 className="text-xl font-semibold text-fg">Account</h1>
            <p className="mt-1 text-xs text-fg-secondary">
              Your details and password. Changing your password signs you out everywhere else.
            </p>
          </header>

          <ProfileSection
            user={user}
            onSaved={() => {
              refresh();
              queryClient.invalidateQueries({ queryKey: ["session"] });
            }}
          />
          <PasswordSection />

          <section className="mt-8">
            <h2 className="text-sm font-medium text-fg">Membership</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border-default px-3 py-2.5 last:border-b-0">
                <span className="text-sm text-fg">Instance role</span>
                <Badge tone={user.instanceRole === "admin" ? "info" : "neutral"}>
                  {user.instanceRole}
                </Badge>
              </div>
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between gap-3 border-b border-border-default px-3 py-2.5 last:border-b-0"
                >
                  <span className="truncate text-sm text-fg">{team.name}</span>
                  <Badge tone="neutral">{team.role}</Badge>
                </div>
              ))}
            </div>
          </section>

          <DeleteAccountSection />
        </div>
      </div>
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
    <section className="mt-8">
      <h2 className="text-sm font-medium text-danger">Delete account</h2>
      <div className="mt-3 rounded-lg border border-danger/25 bg-surface p-3">
        <p className="text-xs text-fg-secondary">
          This cannot be undone. Any team where you are the only member is deleted too, along with
          its projects and their files on disk. You will be refused if you are the last owner of a
          team that still has members, or the last administrator of this instance.
        </p>

        {open ? (
          <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
            <label htmlFor="delete-password" className="text-xs font-medium text-fg-secondary">
              Your password
            </label>
            <PasswordInput
              id="delete-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <label htmlFor="delete-confirm" className="text-xs font-medium text-fg-secondary">
              Type <span className="font-mono text-fg">delete</span> to confirm
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
                {busy ? "Deleting…" : "Delete my account"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        )}
      </div>
    </section>
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
    <form onSubmit={submit} className="mt-7">
      <h2 className="text-sm font-medium text-fg">Profile</h2>
      <div className="mt-3 space-y-3 rounded-lg border border-border-default bg-surface p-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-name" className="text-xs font-medium text-fg-secondary">
            Name
          </label>
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-email" className="text-xs font-medium text-fg-secondary">
            Email
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
            <label htmlFor="profile-confirm" className="text-xs font-medium text-fg-secondary">
              Current password
            </label>
            <PasswordInput
              id="profile-confirm"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Required to change your email"
            />
          </div>
        )}

        <Feedback state={state} />

        <Button type="submit" variant="primary" disabled={!dirty || state.busy}>
          {state.busy ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
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
    <form onSubmit={submit} className="mt-8">
      <h2 className="text-sm font-medium text-fg">Password</h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        At least 10 characters. Every other signed-in device will be signed out.
      </p>

      <div className="mt-3 space-y-3 rounded-lg border border-border-default bg-surface p-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password-current" className="text-xs font-medium text-fg-secondary">
            Current password
          </label>
          <PasswordInput
            id="password-current"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password-new" className="text-xs font-medium text-fg-secondary">
            New password
          </label>
          <PasswordInput
            id="password-new"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={10}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password-confirm" className="text-xs font-medium text-fg-secondary">
            Confirm new password
          </label>
          <PasswordInput
            id="password-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
          {mismatch && <span className="text-2xs text-danger">The two entries do not match.</span>}
        </div>

        <Feedback state={state} savedMessage="Password changed. Other devices were signed out." />

        <Button type="submit" variant="primary" disabled={!ready || state.busy}>
          {state.busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
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
