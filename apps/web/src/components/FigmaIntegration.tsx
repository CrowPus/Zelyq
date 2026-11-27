import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { BrandIcon } from "./BrandIcon";
import { Badge, Button, Spinner } from "./ui";

/**
 * Per-user Figma connection (proposal 068). Connecting authorises Zelyq to read
 * your Figma files so `/figma <link>` can rebuild a frame as a website. The
 * OAuth token is held entirely server-side — this UI only ever sees whether a
 * connection exists and which scopes it has.
 */
export function FigmaIntegration() {
  const qc = useQueryClient();
  // Only the server's administrator can do anything about a missing Figma app.
  const operator = useSession().user?.instanceRole === "admin";
  const [error, setError] = useState<string | null>(null);

  const config = useQuery({ queryKey: ["figma-config"], queryFn: api.figmaConfig });
  const connection = useQuery({ queryKey: ["figma-connection"], queryFn: api.figmaConnection });

  const startOAuth = useMutation({
    mutationFn: () => api.startFigmaOAuth(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const disconnect = useMutation({
    mutationFn: () => api.disconnectFigma(),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["figma-connection"] });
    },
    onError: (caught) => setError((caught as Error).message),
  });

  if (config.isLoading) return null;

  const configured = config.data?.configured ?? false;
  const connected = connection.data?.connection ?? null;

  return (
    <section className="mt-7">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <BrandIcon brand="figma" className="text-fg-muted" />
        {t("Figma")}
      </h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        {t(
          "Connect Figma to use {code} in the composer — the agent rebuilds a frame as a website in your project. Read-only; the token stays on the server.",
          { code: <code>/figma &lt;link&gt;</code> },
        )}
      </p>

      {!configured && !operator ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-border-default bg-surface-subtle px-2.5 py-2 text-xs text-fg-secondary">
          <Lock size={13} strokeWidth={1.75} className="mt-px shrink-0 text-fg-muted" />
          <span>{t("Figma isn’t available here yet.")}</span>
        </p>
      ) : !configured ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-border-default bg-surface-subtle px-2.5 py-2 text-xs text-fg-secondary">
          <Lock size={13} strokeWidth={1.75} className="mt-px shrink-0 text-fg-muted" />
          <span>
            {t(
              "Not set up. An operator needs to register a Figma OAuth app ({link}) and set {code} and {code2}. See {link2}.",
              {
                link: (
                  <a
                    href="https://www.figma.com/developers/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-fg"
                  >
                    {t("figma.com → OAuth apps")}
                  </a>
                ),
                code: <code className="font-mono">ZELYQ_FIGMA_CLIENT_ID</code>,
                code2: <code className="font-mono">ZELYQ_FIGMA_CLIENT_SECRET</code>,
                link2: (
                  <a
                    href="https://github.com/CrowPus/Zelyq/blob/main/docs/configuration.md"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-fg"
                  >
                    docs/configuration.md
                  </a>
                ),
              },
            )}
          </span>
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          {connected ? (
            <>
              <Badge tone="success">{t("Connected")}</Badge>
              <span className="text-2xs text-fg-muted">
                {connected.grantedScopes.join(", ") || t("read access")}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? <Spinner /> : <Unplug size={12} strokeWidth={2} />}
                {t("Disconnect")}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => startOAuth.mutate()} disabled={startOAuth.isPending}>
              {startOAuth.isPending ? <Spinner /> : <Plug size={12} strokeWidth={2} />}
              {t("Connect Figma")}
            </Button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-2xs text-danger">{error}</p>}
    </section>
  );
}
