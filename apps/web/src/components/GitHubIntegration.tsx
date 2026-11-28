import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Lock, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { BrandIcon } from "./BrandIcon";
import { Badge, Button, Spinner } from "./ui";

/**
 * Team settings → Integrations → GitHub. A team admin connects the GitHub accounts and
 * organizations the team works in; GitHub asks which repositories Zelyq may reach. After that,
 * importing, pushing, pull requests and pipelines need no token. Everyone in the team sees what
 * is connected; only its admins change it.
 */
export function GitHubIntegration({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const operator = useSession().user?.instanceRole === "admin";
  const [error, setError] = useState<string | null>(null);
  // Back from GitHub: said once.
  const [returned] = useState(() => new URLSearchParams(window.location.search).get("github"));

  const github = useQuery({
    queryKey: ["team-github", teamId],
    queryFn: () => api.teamGitHub(teamId),
  });

  const connect = useMutation({
    mutationFn: () => api.connectGitHub(teamId),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const disconnect = useMutation({
    mutationFn: (connectionId: string) => api.disconnectGitHub(teamId, connectionId),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["team-github", teamId] });
      qc.invalidateQueries({ queryKey: ["github-repositories", teamId] });
    },
    onError: (caught) => setError((caught as Error).message),
  });

  if (github.isLoading) return null;
  const status = github.data?.status;
  const connections = github.data?.connections ?? [];
  const oauth = status?.mode === "oauth";

  return (
    <section className="mt-7" id="github">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <BrandIcon brand="github" className="text-fg-muted" />
        {t("GitHub")}
      </h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        {oauth
          ? t(
              "Connect GitHub to import repositories, push, open pull requests and run pipelines without a token. Zelyq works with the repositories your GitHub account can push to.",
            )
          : t(
              "Connect GitHub to import repositories, push, open pull requests and run pipelines without a token. GitHub asks which repositories Zelyq may reach.",
            )}
      </p>

      {!status?.configured ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-border-default bg-surface-subtle px-2.5 py-2 text-xs text-fg-secondary">
          <Lock size={13} strokeWidth={1.75} className="mt-px shrink-0 text-fg-muted" />
          <span>
            {operator
              ? t("Not set up on this server yet. Turn it on in {link}.", {
                  link: (
                    <Link
                      to="/admin#integrations"
                      className="underline underline-offset-2 hover:text-fg"
                    >
                      {t("Server settings → Integrations")}
                    </Link>
                  ),
                })
              : t("GitHub isn’t available on this server yet. A server admin can turn it on.")}
          </span>
        </p>
      ) : (
        <>
          {returned === "connected" && (
            <p className="mt-3 text-xs text-success">{t("GitHub is connected.")}</p>
          )}
          {connections.length > 0 && (
            <ul className="mt-3 divide-y divide-border-default rounded-md border border-border-default">
              {connections.map((connection) => (
                <li key={connection.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  {connection.account.avatarUrl ? (
                    <img
                      src={connection.account.avatarUrl}
                      alt=""
                      className="size-6 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <BrandIcon brand="github" size={20} className="text-fg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {connection.account.login}
                    </p>
                    <p className="text-2xs text-fg-muted">
                      {connection.account.type === "Organization"
                        ? t("Organization")
                        : t("Personal account")}
                    </p>
                  </div>
                  <a
                    href={connection.manageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
                  >
                    {oauth ? t("Manage on GitHub") : t("Choose repositories")}{" "}
                    <ExternalLink size={11} aria-hidden />
                  </a>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => disconnect.mutate(connection.id)}
                      disabled={disconnect.isPending}
                    >
                      {disconnect.isPending && disconnect.variables === connection.id ? (
                        <Spinner />
                      ) : (
                        <Unplug size={12} strokeWidth={2} />
                      )}
                      {t("Disconnect")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? <Spinner /> : <Plug size={12} strokeWidth={2} />}
                {connections.length > 0 ? t("Connect another account") : t("Connect GitHub")}
              </Button>
              {connections.length > 0 && (
                <Badge tone="success">{t("{n} connected", { n: connections.length })}</Badge>
              )}
            </div>
          ) : (
            connections.length === 0 && (
              <p className="mt-3 text-xs text-fg-muted">
                {t("A team admin connects the team’s GitHub here.")}
              </p>
            )
          )}
          {oauth && connections.length > 0 && (
            <p className="mt-2 text-2xs text-fg-muted">
              {t(
                "Missing an organization’s repositories? It may need to allow Zelyq first: open Manage on GitHub and request access for it.",
              )}
            </p>
          )}
          {!oauth && !status.webhooks && connections.length > 0 && (
            <p className="mt-2 text-2xs text-fg-muted">
              {t(
                "GitHub cannot reach this server, so a push does not start a pipeline by itself. A pipeline’s push trigger still works with its own webhook.",
              )}
            </p>
          )}
        </>
      )}

      {(error || (returned && returned !== "connected")) && (
        <p className="mt-2 text-2xs text-danger">
          {error ??
            (returned === "not-yours"
              ? t(
                  "GitHub was not connected: only the owner of an account or organization can connect it. Ask an owner to connect it, or install the app on an account you own.",
                )
              : returned === "expired"
                ? t("That GitHub connection timed out. Press Connect GitHub again.")
                : t("GitHub was not connected. Try again."))}
        </p>
      )}
    </section>
  );
}
