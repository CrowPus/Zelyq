import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpsAlertView, OpsCheckView, OpsStatusApp, OpsStatusView } from "@zelyq/core";
import { BellOff, CheckCircle2, Eye } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { formatTime } from "../../lib/format";
import { t } from "../../lib/i18n";
import { opsText } from "../../lib/opsWords";
import { formatRelative } from "../../lib/vault";
import { Badge, Button, EmptyState, NativeSelect, Spinner } from "../ui";

/**
 * The watch, on the Ops page (072 §4): one honest light per app, its uptime
 * for the last 30 days, what is open now and what ended lately. A person
 * answers an alert here ("I'm on it", or silence it for planned work).
 */

const LIGHT: Record<OpsStatusApp["light"], { dot: string; words: string }> = {
  green: { dot: "bg-success", words: t("Running well") },
  amber: { dot: "bg-warning", words: t("Slow or needs attention") },
  red: { dot: "bg-danger", words: t("Down") },
  grey: { dot: "bg-fg-muted", words: t("Not checked yet") },
};

const STATE_WORDS: Record<OpsCheckView["state"], string> = {
  ok: "ok",
  failing: "failing",
  unknown: t("not known yet"),
};

function uptimeWords(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value === 100 ? 0 : 2)}%`;
}

export function StatusTab({
  teamId,
  canAnswer,
  isAdmin,
}: {
  teamId: string;
  canAnswer: boolean;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["ops-status", teamId],
    queryFn: () => api.ops.status(teamId),
    refetchInterval: 30_000,
  });
  const [error, setError] = useState<string | null>(null);
  const keep = (next: OpsStatusView) => {
    queryClient.setQueryData(["ops-status", teamId], next);
    setError(null);
  };
  const acknowledge = useMutation({
    mutationFn: (alertId: string) => api.ops.acknowledge(teamId, alertId),
    onSuccess: keep,
    onError: (caught) => setError((caught as Error).message),
  });
  const silence = useMutation({
    mutationFn: (input: { alertId: string; minutes: number }) =>
      api.ops.silence(teamId, input.alertId, input.minutes),
    onSuccess: keep,
    onError: (caught) => setError((caught as Error).message),
  });
  const setCheck = useMutation({
    mutationFn: (input: { checkId: string; enabled: boolean }) =>
      api.ops.setCheck(teamId, input.checkId, input.enabled),
    onSuccess: keep,
    onError: (caught) => setError((caught as Error).message),
  });

  if (status.isLoading) return <Spinner />;
  const view = status.data;
  if (!view) return <p className="text-sm text-danger">{t("The status could not be read.")}</p>;
  const nothing = view.apps.length === 0 && view.machines.length === 0 && view.other.length === 0;

  return (
    <div className="grid gap-6">
      <p className="text-xs text-fg-secondary">
        {t("Checked by Zelyq every minute, with no AI and whatever the spending limit. ")}
        {view.watchedFromTwoPlaces ? (
          t("Watched from two places.")
        ) : (
          <span className="text-warning">
            {t(
              "Watched from one place only: if this server goes down, nobody is told. A second watcher on another machine comes next.",
            )}
          </span>
        )}
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}

      {view.open.length > 0 && (
        <section aria-label={t("Open alerts")} className="grid gap-2">
          <h2 className="text-sm font-medium">{t("Open now")}</h2>
          {view.open.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              canAnswer={canAnswer}
              busy={acknowledge.isPending || silence.isPending}
              onAcknowledge={() => acknowledge.mutate(alert.id)}
              onSilence={(minutes) => silence.mutate({ alertId: alert.id, minutes })}
            />
          ))}
        </section>
      )}

      {nothing ? (
        <EmptyState
          title={t("Nothing to watch yet")}
          description={t(
            "As soon as an app is live on one of your environments, its address, its speed, its container and its machine are watched here, by themselves.",
          )}
        />
      ) : (
        <>
          <section aria-label={t("Apps")} className="grid gap-3">
            <h2 className="text-sm font-medium">{t("Apps")}</h2>
            {view.apps.map((app) => (
              <AppCard
                key={`${app.environment}/${app.app}`}
                app={app}
                isAdmin={isAdmin}
                onSwitch={(checkId, enabled) => setCheck.mutate({ checkId, enabled })}
              />
            ))}
          </section>
          {view.machines.length + view.other.length > 0 && (
            <section aria-label={t("Machines and more")} className="grid gap-2">
              <h2 className="text-sm font-medium">{t("Machines, domains and pipelines")}</h2>
              <ul className="divide-y divide-border-default rounded-md border border-border-default bg-surface">
                {[...view.machines, ...view.other].map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    isAdmin={isAdmin}
                    onSwitch={(enabled) => setCheck.mutate({ checkId: check.id, enabled })}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {view.recent.length > 0 && (
        <section aria-label={t("Lately")} className="grid gap-1">
          <h2 className="text-sm font-medium">{t("Lately")}</h2>
          <ul className="text-xs text-fg-secondary">
            {view.recent.map((alert) => (
              <li key={alert.id} className="flex gap-2 py-0.5">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                <span>
                  {opsText(alert.title)} — {alert.closedHow ? opsText(alert.closedHow) : t("over")},{" "}
                  {formatRelative(alert.closedAt ?? alert.openedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  canAnswer,
  busy,
  onAcknowledge,
  onSilence,
}: {
  alert: OpsAlertView;
  canAnswer: boolean;
  busy: boolean;
  onAcknowledge: () => void;
  onSilence: (minutes: number) => void;
}) {
  const silenced = alert.silencedUntil && new Date(alert.silencedUntil) > new Date();
  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-md border px-3 py-2 text-sm ${
        alert.severity === "urgent"
          ? "border-danger/40 bg-danger-subtle"
          : "border-warning/40 bg-warning-subtle"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {opsText(alert.title)}{" "}
          <Badge tone={alert.severity === "urgent" ? "danger" : "warning"}>
            {alert.severity === "urgent" ? t("urgent") : t("warning")}
          </Badge>
        </p>
        <p className="text-xs text-fg-secondary">
          {t("{detail} · since {openedAt}{value}{value2}", {
            detail: opsText(alert.detail),
            openedAt: formatRelative(alert.openedAt),
            value: alert.acknowledgedAt ? t(" · someone is on it") : "",
            value2: silenced
              ? t(" · silenced until {value}", { value: formatTime(alert.silencedUntil as string) })
              : "",
          })}
        </p>
      </div>
      {canAnswer && (
        <div className="flex flex-wrap items-center gap-2">
          {!alert.acknowledgedAt && (
            <Button
              size="sm"
              variant="primary"
              icon={<Eye size={13} />}
              disabled={busy}
              onClick={onAcknowledge}
            >
              {t("I’m on it")}
            </Button>
          )}
          {!silenced && (
            <NativeSelect
              aria-label={t("Silence for planned work")}
              value=""
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) onSilence(Number(event.target.value));
              }}
            >
              <option value="">{t("Silence…")}</option>
              <option value="30">{t("for 30 minutes")}</option>
              <option value="60">{t("for 1 hour")}</option>
              <option value="240">{t("for 4 hours")}</option>
              <option value="1440">{t("for a day")}</option>
            </NativeSelect>
          )}
          {silenced && <BellOff size={14} className="text-fg-muted" aria-label={t("Silenced")} />}
        </div>
      )}
    </div>
  );
}

function AppCard({
  app,
  isAdmin,
  onSwitch,
}: {
  app: OpsStatusApp;
  isAdmin: boolean;
  onSwitch: (checkId: string, enabled: boolean) => void;
}) {
  const light = LIGHT[app.light];
  return (
    <div className="rounded-md border border-border-default bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className={`size-2.5 rounded-full ${light.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {t("{app} on {name}", {
              app: app.app,
              name: <span className="font-normal text-fg-secondary">{app.environment}</span>,
            })}
          </p>
          <p className="text-xs text-fg-secondary">
            {light.words}
            {app.url ? ` · ${app.url}` : ""}
          </p>
        </div>
        <dl className="flex gap-4 text-xs">
          <div>
            <dt className="text-fg-muted">{t("Up, 30 days")}</dt>
            <dd className="font-medium">{uptimeWords(app.uptime30d)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("Usually answers in")}</dt>
            <dd className="font-medium">{app.normalMs === null ? "—" : `${app.normalMs} ms`}</dd>
          </div>
        </dl>
      </div>
      <ul className="divide-y divide-border-default border-t border-border-default">
        {app.checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            isAdmin={isAdmin}
            onSwitch={(enabled) => onSwitch(check.id, enabled)}
          />
        ))}
      </ul>
    </div>
  );
}

function CheckRow({
  check,
  isAdmin,
  onSwitch,
}: {
  check: OpsCheckView;
  isAdmin: boolean;
  onSwitch: (enabled: boolean) => void;
}) {
  const tone = !check.enabled
    ? "text-fg-muted"
    : check.state === "failing"
      ? "text-danger"
      : check.state === "ok"
        ? "text-success"
        : "text-fg-muted";
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
      <span className={`w-20 shrink-0 ${tone}`}>
        {check.enabled ? STATE_WORDS[check.state] : t("switched off")}
      </span>
      <span className="min-w-0 flex-1">
        {opsText(check.title)}
        {check.lastDetail && check.enabled && (
          <span className="text-fg-muted"> — {opsText(check.lastDetail)}</span>
        )}
      </span>
      {check.lastCheckedAt && check.enabled && (
        <span className="text-fg-muted">{formatRelative(check.lastCheckedAt)}</span>
      )}
      {isAdmin && (
        <button
          type="button"
          onClick={() => onSwitch(!check.enabled)}
          className="text-fg-secondary hover:underline"
        >
          {check.enabled ? t("Switch off") : t("Switch on")}
        </button>
      )}
    </li>
  );
}
