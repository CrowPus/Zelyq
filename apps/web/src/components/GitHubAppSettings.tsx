import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plug, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { BrandIcon } from "./BrandIcon";
import { Badge, Button, Checkbox, confirmAction, Field, Input, Spinner } from "./ui";

/**
 * Server settings → Integrations → GitHub. One GitHub App serves every team on this server.
 * Creating it is one trip to GitHub: Zelyq sends GitHub the app's description (permissions,
 * addresses), the admin presses Create there, and GitHub sends the app's keys straight back.
 * When the server's environment gives the app, it is only shown.
 */
export function GitHubAppSettings() {
  const qc = useQueryClient();
  const [organization, setOrganization] = useState("");
  const [anyAccount, setAnyAccount] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returned] = useState(() => new URLSearchParams(window.location.search).get("github"));
  const status = useQuery({ queryKey: ["github-status"], queryFn: api.githubStatus });

  const create = useMutation({
    mutationFn: () =>
      api.githubAppManifest({ organization: organization.trim() || null, public: anyAccount }),
    onSuccess: ({ action, manifest }) => {
      // GitHub takes the description as a posted form.
      const form = document.createElement("form");
      form.method = "post";
      form.action = action;
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "manifest";
      field.value = JSON.stringify(manifest);
      form.append(field);
      document.body.append(form);
      form.submit();
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api.removeGitHubApp(),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["github-status"] });
    },
    onError: (caught) => setError((caught as Error).message),
  });

  if (status.isLoading) return null;
  const app = status.data?.status;

  return (
    <section className="mt-7" id="github">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <BrandIcon brand="github" className="text-fg-muted" />
        {t("GitHub")}
      </h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        {t(
          "Teams connect GitHub with a click instead of pasting a token. This server uses one GitHub App for that; create it here once.",
        )}
      </p>

      {returned === "created" && app?.configured && (
        <p className="mt-3 text-xs text-success">
          {t("The GitHub App is ready. Teams can connect GitHub in Team settings → Integrations.")}
        </p>
      )}

      {app?.mode === "oauth" ? (
        <div className="mt-3 rounded-md border border-border-default px-3 py-2.5">
          <Badge tone="success">{t("Ready")}</Badge>
          <p className="mt-1.5 text-2xs text-fg-muted">
            {t(
              "Uses this server’s GitHub sign-in app, set in its environment. Teams connect GitHub in Team settings → Integrations.",
            )}
          </p>
        </div>
      ) : app?.configured ? (
        <div className="mt-3 rounded-md border border-border-default px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="success">{t("Ready")}</Badge>
            <span className="text-sm font-medium text-fg">{app.slug}</span>
            {app.owner && (
              <span className="text-xs text-fg-muted">{t("on {owner}", { owner: app.owner })}</span>
            )}
            {app.htmlUrl && (
              <a
                href={app.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
              >
                {t("Open on GitHub")} <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
          <p className="mt-1.5 text-2xs text-fg-muted">
            {app.webhooks
              ? t("Pushes and pull requests reach Zelyq by themselves.")
              : t(
                  "GitHub cannot reach this server, so pushes do not start pipelines by themselves. Everything else works.",
                )}
          </p>
          {app.source === "env" ? (
            <p className="mt-1.5 text-2xs text-fg-muted">
              {t("Set in this server’s environment, so it is changed there.")}
            </p>
          ) : (
            <div className="mt-2.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirmAction({
                      title: t("Remove the GitHub App from this server?"),
                      description: t(
                        "Teams’ GitHub connections stop working until a new one is created. The app stays on GitHub, where you can delete it.",
                      ),
                      confirmLabel: t("Remove from this server"),
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                {remove.isPending ? <Spinner /> : <Trash2 size={12} strokeWidth={2} />}
                {t("Remove from this server")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form
          className="mt-3 space-y-3 rounded-md border border-border-default px-3 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Field label={t("GitHub organization (optional)")}>
            <Input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder={t("Leave empty to create it on your own account")}
              className="max-w-sm"
              autoComplete="off"
            />
          </Field>
          <div className="flex items-start gap-2 text-xs text-fg-secondary">
            <Checkbox
              id="github-any-account"
              checked={anyAccount}
              onCheckedChange={setAnyAccount}
            />
            <label htmlFor="github-any-account">
              {t(
                "Any GitHub account may connect it. Off: only the account or organization that owns it.",
              )}
            </label>
          </div>
          <Button size="sm" type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plug size={12} strokeWidth={2} />}
            {t("Create GitHub App")}
          </Button>
          <p className="text-2xs text-fg-muted">
            {t(
              "GitHub opens with everything filled in. Press Create there and you come back here.",
            )}
          </p>
        </form>
      )}

      {(error || returned === "error") && (
        <p className="mt-2 text-2xs text-danger">
          {error ?? t("The GitHub App was not created. Try again.")}
        </p>
      )}
    </section>
  );
}
