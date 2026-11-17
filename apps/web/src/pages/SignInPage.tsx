import { useQuery } from "@tanstack/react-query";
import { accountServiceLinks } from "@zelyq/core";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AuthNotice } from "../components/AuthCard";
import { Button, Input, PasswordInput, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

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
  const query = new URLSearchParams(window.location.search);
  const oidcError = query.has("error");
  const suspended = query.get("error") === "suspended";
  const signIn = status.data?.signIn;
  const accounts = status.data?.accounts ?? null;
  // Managed: the account service is the way in. `?local=1` keeps the form for
  // the server's own administrators, so they can always reach it.
  const local = query.get("local") === "1";
  const serviceOnly = Boolean(signIn?.oidcOnly) && !local;
  // Where they were going (a shared link): signing in brings them back there.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const startUrl = `/api/auth/oidc/start${from && from !== "/" ? `?return_to=${encodeURIComponent(from)}` : ""}`;
  // Managed: straight to the account service. Someone already signed in there
  // comes back signed in here without typing anything. Not after a failure,
  // which would loop.
  const goStraight = serviceOnly && Boolean(accounts) && !oidcError;
  useEffect(() => {
    if (goStraight) window.location.replace(startUrl);
  }, [goStraight, startUrl]);

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
      else await api.login({ email, password });
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
      <div className="grid h-dvh place-items-center bg-canvas px-4">
        <div className="w-full max-w-[340px]">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <img src="/zelyq-mark-64.png" alt="" width={32} height={32} className="size-8" />
            <div>
              <h1 className="text-lg font-semibold text-fg">Sign in to Zelyq</h1>
              <p className="mt-1 text-xs text-fg-secondary">
                Your account is with {accounts.name}.
              </p>
            </div>
          </div>
          {oidcError && (
            <p className="mb-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              {suspended
                ? `This account is suspended. Contact ${accounts.name} for help.`
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
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <img src="/zelyq-mark-64.png" alt="" width={32} height={32} className="size-8" />
          <div>
            <h1 className="text-lg font-semibold text-fg">
              {firstRun
                ? "Set up Zelyq"
                : registering
                  ? "Create an account"
                  : forgot
                    ? "Reset your password"
                    : "Sign in to Zelyq"}
            </h1>
            <p className="mt-1 text-xs text-fg-secondary">
              {firstRun
                ? "This instance has no accounts yet. The first one owns it."
                : registering
                  ? "You will get a team of your own."
                  : forgot
                    ? "Enter your account's email. We will send a link to choose a new password."
                    : "Use the account an administrator set up for you."}
            </p>
          </div>
        </div>

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
      </div>
    </div>
  );
}
