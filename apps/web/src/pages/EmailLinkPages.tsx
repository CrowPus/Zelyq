import { useQuery } from "@tanstack/react-query";
import { accountServiceLinks } from "@zelyq/core";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard, AuthError } from "../components/AuthCard";
import { Button, Input, PasswordInput, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { teamKey, teamPaths } from "../lib/routes";

/**
 * The pages an emailed link opens. The token rides in the address's #fragment,
 * which the browser never sends to the server, so it is read here once and the
 * fragment is cleared: it does not linger in the address bar or the history.
 */
function useLinkToken(): string {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
    return value;
  });
  return token;
}

function NoLink(props: { what: string }) {
  return (
    <AuthCard
      title="This link is not complete"
      subtitle={`Open the ${props.what} link from your email again, the whole of it.`}
    >
      <p className="text-center text-xs">
        <Link to="/signin" className="text-info underline underline-offset-2 hover:no-underline">
          Go to sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useLinkToken();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) return <NoLink what="password reset" />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError("The two passwords are different.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.resetPassword({ token, password });
      if ("signInAgain" in result) {
        // Two-factor on: the link proved the email, not the phone.
        navigate("/signin", { replace: true, state: { notice: "passwordChanged" } });
        return;
      }
      refresh();
      navigate("/", { replace: true });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="You will be signed out everywhere else, and signed in here."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reset-password" className="text-xs font-medium text-fg-secondary">
            New password
          </label>
          <PasswordInput
            id="reset-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
            placeholder="At least 10 characters"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reset-repeat" className="text-xs font-medium text-fg-secondary">
            New password again
          </label>
          <PasswordInput
            id="reset-repeat"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
          />
        </div>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy ? "Working…" : "Set password and sign in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-fg-muted">
        Remembered it?{" "}
        <Link to="/signin" className="text-info underline underline-offset-2 hover:no-underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export function InvitePage() {
  const token = useLinkToken();
  const { user, refresh, signOut } = useSession();
  const navigate = useNavigate();
  // Signing in comes back here with the link still in hand: no need to find the email again.
  const backHere = { state: { from: `/invite#token=${token}` } };
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.authStatus });
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.lookupInvite(token),
    enabled: Boolean(token),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!token) return <NoLink what="invitation" />;

  if (invite.isLoading) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  if (invite.error || !invite.data) {
    return (
      <AuthCard
        title="This invitation cannot be used"
        subtitle={
          (invite.error as Error | null)?.message ??
          "Ask the person who invited you to send a new one."
        }
      >
        <p className="text-center text-xs">
          <Link to="/signin" className="text-info underline underline-offset-2 hover:no-underline">
            Go to sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  const details = invite.data;
  const signedInAsOther = user && user.email !== details.email;
  const needsSignIn = details.accountExists && !user;
  // Managed: everyone signs in (or signs up) with the account service, then
  // comes straight back here to accept.
  const accounts = status.data?.signIn.oidcOnly ? (status.data.accounts ?? null) : null;
  const throughService = `/api/auth/oidc/start?return_to=${encodeURIComponent(`/invite#token=${token}`)}`;

  async function accept(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accepted = await api.acceptInvite(
        details.accountExists ? { token } : { token, name, password },
      );
      refresh();
      // Straight into the team just joined, by its own address.
      const joined = accepted.teams.find((t) => t.id === accepted.teamId);
      navigate(joined ? teamPaths(teamKey(joined)).members : "/", { replace: true });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const subtitle = (
    <>
      {details.invitedBy ?? "Someone"} invited{" "}
      <span className="font-medium text-fg">{details.email}</span> to join as{" "}
      {/^[aeiou]/i.test(details.role) ? "an" : "a"} {details.role}.
    </>
  );

  if (signedInAsOther) {
    return (
      <AuthCard title={`Join ${details.teamName}`} subtitle={subtitle}>
        <AuthError>
          You are signed in as {user.email}, but this invitation is for {details.email}.
        </AuthError>
        <Button
          type="button"
          variant="primary"
          className="mt-4 w-full"
          onClick={async () => {
            await signOut(`/invite#token=${token}`);
            navigate("/signin", backHere);
          }}
        >
          Sign out and continue as {details.email}
        </Button>
      </AuthCard>
    );
  }

  if (accounts && !user) {
    return (
      <AuthCard title={`Join ${details.teamName}`} subtitle={subtitle}>
        <p className="text-center text-xs text-fg-secondary">
          Sign in with {accounts.name} as {details.email}, or create your account there, and you
          will come straight back here to join.
        </p>
        <Button
          type="button"
          variant="primary"
          className="mt-4 w-full"
          onClick={() => window.location.assign(throughService)}
        >
          Continue with {accounts.name}
        </Button>
        <p className="mt-3 text-center text-xs text-fg-muted">
          No account?{" "}
          <a
            href={accountServiceLinks(accounts).signup(
              `${window.location.origin}${throughService}`,
            )}
            className="text-info underline underline-offset-2 hover:no-underline"
          >
            Create one at {accounts.name}
          </a>
        </p>
      </AuthCard>
    );
  }

  if (needsSignIn) {
    return (
      <AuthCard title={`Join ${details.teamName}`} subtitle={subtitle}>
        <p className="text-center text-xs text-fg-secondary">
          {details.email} already has an account. Sign in, and you will come straight back here.
        </p>
        <Button
          type="button"
          variant="primary"
          className="mt-4 w-full"
          onClick={() => navigate("/signin", backHere)}
        >
          Sign in
        </Button>
      </AuthCard>
    );
  }

  if (details.accountExists) {
    return (
      <AuthCard title={`Join ${details.teamName}`} subtitle={subtitle}>
        {error && (
          <div className="mb-3">
            <AuthError>{error}</AuthError>
          </div>
        )}
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          className="w-full"
          onClick={() => accept()}
        >
          {busy ? "Working…" : `Join ${details.teamName}`}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${details.teamName}`} subtitle={subtitle}>
      <form onSubmit={accept} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-xs font-medium text-fg-secondary">
            Email
          </label>
          <Input id="invite-email" value={details.email} readOnly disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-name" className="text-xs font-medium text-fg-secondary">
            Your name
          </label>
          <Input
            id="invite-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            placeholder="Ada Lovelace"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-password" className="text-xs font-medium text-fg-secondary">
            Choose a password
          </label>
          <PasswordInput
            id="invite-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
            placeholder="At least 10 characters"
          />
        </div>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy ? "Working…" : "Create account and join"}
        </Button>
      </form>
    </AuthCard>
  );
}
