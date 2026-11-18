import { useQuery } from "@tanstack/react-query";
import { accountServiceLinks } from "@zelyq/core";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthHeading, AuthLayout, AuthNotice } from "../components/AuthCard";
import { Button, Field, Input, PasswordInput, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { type ApiError, api } from "../lib/api";

/**
 * Sign in, register, and first-run setup are one screen. Splitting them across
 * routes means guessing which one a visitor needs; the server already knows
 * whether the instance has any accounts.
 */
export function SignInPage() {
  const { refresh } = useSession();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.authStatus });

  const firstRun = status.data?.firstRun ?? false;
  const [mode, setMode] = useState<"signin" | "register" | "forgot">("signin");
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Password (or single sign-on) accepted, two-factor on: the code completes
   * this challenge. Single sign-on hands it over after the # of the address.
   */
  const [challenge, setChallenge] = useState<string | null>(() => {
    const match = /two-factor=([^&]+)/.exec(window.location.hash);
    return match ? decodeURIComponent(match[1]!) : null;
  });
  useEffect(() => {
    if (window.location.hash.includes("two-factor=")) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);
  const query = new URLSearchParams(window.location.search);
  const oidcError = query.has("error");
  const suspended = query.get("error") === "suspended";
  const unavailable = query.get("error") === "unavailable";
  const signIn = status.data?.signIn;
  const accounts = status.data?.accounts ?? null;
  // Managed: the account service is the way in. `?local=1` keeps the form for
  // the server's own administrators, so they can always reach it.
  const local = query.get("local") === "1";
  const serviceOnly = Boolean(signIn?.oidcOnly) && !local;
  // Where they were going (a shared link): signing in brings them back there.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const passwordChanged =
    (location.state as { notice?: string } | null)?.notice === "passwordChanged";
  const startUrl = `/api/auth/oidc/start${from && from !== "/" ? `?return_to=${encodeURIComponent(from)}` : ""}`;
  // Managed: straight to the account service. Someone already signed in there
  // comes back signed in here without typing anything. Not after a failure,
  // which would loop.
  const goStraight = serviceOnly && Boolean(accounts) && !oidcError && !challenge;
  useEffect(() => {
    if (goStraight) window.location.replace(startUrl);
  }, [goStraight, startUrl]);
  // The account service couldn't be reached: the message stays on the page, not in
  // the address (so reopening or reloading tries again), and it tries again by itself.
  useEffect(() => {
    if (!unavailable || !serviceOnly) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const retry = window.setTimeout(() => window.location.replace(startUrl), 15_000);
    return () => window.clearTimeout(retry);
  }, [unavailable, serviceOnly, startUrl]);

  const registering = firstRun || (mode === "register" && Boolean(signIn?.register));
  const forgot = !firstRun && mode === "forgot";
  const canReset = Boolean(signIn?.passwordReset);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (forgot) {
        await api.forgotPassword(email);
        setSent(true);
        return;
      }
      if (registering) await api.register({ email, name, password });
      else {
        const result = await api.login({ email, password });
        if ("twoFactor" in result) {
          setChallenge(result.twoFactor.challenge);
          return;
        }
      }
      // The router decides where to land — see AfterSignIn in App.tsx.
      refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status.isLoading) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  if (goStraight) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <div className="flex flex-col items-center gap-3 text-xs text-fg-secondary">
          <Spinner />
          Taking you to {accounts?.name}…
        </div>
      </div>
    );
  }

  if (serviceOnly && accounts) {
    return (
      <AuthLayout>
        <AuthHeading title="Sign in to Zelyq" subtitle={`Your account is with ${accounts.name}.`} />
        {oidcError && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {suspended
              ? `This account is suspended. Contact ${accounts.name} for help.`
              : unavailable
                ? `${accounts.name} can't be reached right now. Try again in a minute.`
                : "Signing in could not be completed. Please try again."}
          </p>
        )}
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => window.location.assign(startUrl)}
        >
          {signIn?.oidcLabel}
        </Button>
        <p className="mt-4 text-center text-xs text-fg-muted">
          No account?{" "}
          <a
            href={accountServiceLinks(accounts).signup(`${window.location.origin}/`)}
            className="text-info underline underline-offset-2 hover:no-underline"
          >
            Create one at {accounts.name}
          </a>
        </p>
      </AuthLayout>
    );
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onDone={refresh}
        onRestart={(message) => {
          setChallenge(null);
          setPassword("");
          setError(message);
        }}
      />
    );
  }

  return (
    <AuthLayout>
      <AuthHeading
        title={
          firstRun
            ? "Set up Zelyq"
            : registering
              ? "Create an account"
              : forgot
                ? "Reset your password"
                : "Sign in to Zelyq"
        }
        subtitle={
          firstRun
            ? "This instance has no accounts yet. The first one owns it."
            : registering
              ? "You will get a team of your own."
              : forgot
                ? "Enter your account's email. We will send a link to choose a new password."
                : "Use the account an administrator set up for you."
        }
      />

      <form onSubmit={submit} className="flex flex-col gap-3">
        {registering && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="signin-name" className="text-xs font-medium text-fg-secondary">
              Name
            </label>
            <Input
              id="signin-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              placeholder="Ada Lovelace"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signin-email" className="text-xs font-medium text-fg-secondary">
            Email
          </label>
          <Input
            id="signin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>

        {!forgot && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="signin-password" className="text-xs font-medium text-fg-secondary">
                Password
              </label>
              {canReset && !registering && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setSent(false);
                  }}
                  className="text-xs text-info underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <PasswordInput
              id="signin-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={registering ? "new-password" : "current-password"}
              required
              minLength={registering ? 10 : undefined}
              placeholder={registering ? "At least 10 characters" : ""}
            />
          </div>
        )}

        {passwordChanged && !error && (
          <AuthNotice>
            Your password is changed. Sign in with it; you will be asked for a code from your
            authenticator app too.
          </AuthNotice>
        )}

        {forgot && sent && (
          <AuthNotice>
            If an account uses {email}, a link is on its way. It works for one hour. Check spam if
            it does not arrive in a few minutes.
          </AuthNotice>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        {oidcError && !error && (
          <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {suspended
              ? "This account is suspended. Contact the server's administrator for help."
              : unavailable
                ? `${accounts?.name ?? "The sign-in service"} can't be reached right now. Try again in a minute.`
                : "Single sign-on could not be completed. Please try again."}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy
            ? "Working…"
            : forgot
              ? sent
                ? "Send again"
                : "Send reset link"
              : firstRun
                ? "Create owner account"
                : registering
                  ? "Create account"
                  : "Sign in"}
        </Button>
      </form>

      {signIn?.oidc && !registering && !forgot && !firstRun && (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => window.location.assign(startUrl)}
        >
          {signIn.oidcLabel}
        </Button>
      )}

      {forgot && (
        <p className="mt-4 text-center text-xs text-fg-muted">
          Remembered it?{" "}
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className="text-info underline underline-offset-2 hover:no-underline"
          >
            Sign in
          </button>
        </p>
      )}

      {!firstRun && !forgot && (registering || signIn?.register) && (
        <p className="mt-4 text-center text-xs text-fg-muted">
          {registering ? "Already have an account?" : "No account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(registering ? "signin" : "register");
              setError(null);
            }}
            className="text-info underline underline-offset-2 hover:no-underline"
          >
            {registering ? "Sign in" : "Create one"}
          </button>
        </p>
      )}
    </AuthLayout>
  );
}

/**
 * The second step: a code from the authenticator app, or a recovery code
 * for someone without their phone.
 */
function TwoFactorStep({
  challenge,
  onDone,
  onRestart,
}: {
  challenge: string;
  onDone(): void;
  onRestart(message: string | null): void;
}) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.loginTwoFactor({ challenge, code });
      onDone();
    } catch (caught) {
      const failure = caught as ApiError;
      // Too slow, or too many tries: back to the password, saying why.
      if (failure.details?.reason === "challenge_expired") onRestart(failure.message);
      else setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeading
        title="Enter your code"
        subtitle={
          recovery
            ? "Type one of the recovery codes you saved when you turned on two-factor sign-in. Each works once."
            : "Open your authenticator app and type the 6-digit code it shows for Zelyq."
        }
      />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label={recovery ? "Recovery code" : "Code"} error={error}>
          <Input
            autoFocus
            value={code}
            onChange={(event) =>
              setCode(
                recovery ? event.target.value : event.target.value.replace(/\D/g, "").slice(0, 6),
              )
            }
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
            className="font-mono tracking-[0.2em]"
            required
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={recovery ? code.trim().length < 8 : code.length !== 6}
        >
          Sign in
        </Button>
      </form>
      <div className="mt-5 flex flex-col items-center gap-2 text-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRecovery((value) => !value);
            setCode("");
            setError(null);
          }}
        >
          {recovery ? "Use a code from your app instead" : "Use a recovery code"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onRestart(null)}>
          Back to sign in
        </Button>
      </div>
    </AuthLayout>
  );
}
