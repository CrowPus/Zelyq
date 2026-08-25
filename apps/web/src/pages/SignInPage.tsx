import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
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
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const oidcError = new URLSearchParams(window.location.search).has("error");

  const registering = firstRun || mode === "register";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
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

  return (
    <div className="grid h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <img src="/zelyq-mark-64.png" alt="" width={32} height={32} className="size-8" />
          <div>
            <h1 className="text-lg font-semibold text-fg">
              {firstRun ? "Set up Zelyq" : registering ? "Create an account" : "Sign in to Zelyq"}
            </h1>
            <p className="mt-1 text-xs text-fg-secondary">
              {firstRun
                ? "This instance has no accounts yet. The first one owns it."
                : registering
                  ? "You will get a team of your own."
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="signin-password" className="text-xs font-medium text-fg-secondary">
              Password
            </label>
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

          {error && (
            <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {oidcError && !error && (
            <p className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              Single sign-on could not be completed. Please try again.
            </p>
          )}

          <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
            {busy
              ? "Working…"
              : firstRun
                ? "Create owner account"
                : registering
                  ? "Create account"
                  : "Sign in"}
          </Button>
        </form>

        {status.data?.oidcEnabled && !registering && (
          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => window.location.assign("/api/auth/oidc/start")}
          >
            Continue with single sign-on
          </Button>
        )}

        {!firstRun && (
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
