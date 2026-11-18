import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OpsChannelKind,
  OpsChannelsView,
  OpsChannelView,
  OpsLinkStart,
  OpsNotifyAudience,
  OpsNotifyPrefs,
  OpsPersonalChannel,
  OpsTeamAudience,
} from "@zelyq/core";
import { OPS_TEAM_AUDIENCES } from "@zelyq/core";
import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Badge, Button, confirmAction, FieldLabel, Input, PasswordInput, Spinner } from "../ui";

/**
 * Where alerts reach people (075 Step 2). Each person links their own
 * Telegram or Slack with a one-time code and chooses what goes where; an admin
 * connects the team's services once. Tokens go in and never come back out.
 */

const SERVICE: Record<OpsChannelKind, string> = {
  telegram: t("Telegram"),
  slack: t("Slack"),
  discord: t("Discord"),
};

const AUDIENCE: Array<{ key: OpsNotifyAudience; words: string; hint: string }> = [
  { key: "urgent", words: t("Urgent"), hint: t("a site or machine is down") },
  { key: "warning", words: t("Warnings"), hint: t("slow, a disk filling, a certificate ending") },
  { key: "approval", words: t("Ops needs you"), hint: t("an approval, a secret, a job finished") },
  { key: "weekly", words: t("Weekly report"), hint: t("how the week went") },
];

const SLACK_MANIFEST = `display_information:
  name: Zelyq
features:
  bot_user:
    display_name: Zelyq
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:write
      - users:read
      - users:read.email
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false`;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AlertsTab({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState<OpsLinkStart | null>(null);
  // Slack: the person says which email their Slack account uses before a code is sent.
  const { user } = useSession();
  const [askingSlack, setAskingSlack] = useState(false);
  const [slackEmail, setSlackEmail] = useState("");
  const view = useQuery({
    queryKey: ["ops-channels", teamId],
    queryFn: () => api.ops.channels(teamId),
    // While a person is linking Telegram, look every few seconds for the chat to appear.
    refetchInterval: linking?.kind === "telegram" ? 3000 : false,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keep = (next: OpsChannelsView) => {
    queryClient.setQueryData(["ops-channels", teamId], next);
    setError(null);
  };
  const failed = (caught: unknown) => {
    setNotice(null);
    setError((caught as Error).message);
  };

  const data = view.data;
  const [linkingSince, setLinkingSince] = useState("");
  // Telegram linked while we waited: the code's job is done.
  useEffect(() => {
    if (
      linking?.kind === "telegram" &&
      data?.links.some(
        (link) =>
          link.kind === "telegram" && link.userId === data.me && link.createdAt > linkingSince,
      )
    ) {
      setLinking(null);
      setNotice(t("Telegram is linked. Alerts will arrive there."));
    }
  }, [data, linking, linkingSince]);

  const startLink = useMutation({
    mutationFn: (input: { kind: OpsChannelKind; slackEmail?: string }) =>
      api.ops.startLink(teamId, input.kind, input.slackEmail),
    onSuccess: (started) => {
      setAskingSlack(false);
      setLinkingSince(new Date(Date.now() - 5000).toISOString());
      setLinking(started);
      setError(null);
      setNotice(null);
    },
    onError: failed,
  });

  if (view.isLoading) return <Spinner />;
  if (!data) return <p className="text-sm text-danger">{t("This could not be read.")}</p>;

  const connected = (kind: OpsChannelKind) => data.channels.find((row) => row.kind === kind);
  const me = data.links.filter((link) => link.userId === data.me);

  return (
    <div className="grid gap-8">
      {error && <p className="text-xs text-danger">{error}</p>}
      {notice && <p className="text-xs text-success">{notice}</p>}

      <section aria-label={t("Your alerts")} className="grid gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("Where your alerts reach you")}</h2>
          <p className="text-xs text-fg-secondary">
            {t(
              "Email always works. Link your own chat to be told there too, then choose what goes where.",
            )}
          </p>
        </div>
        {(["telegram", "slack"] as const).filter((kind) => connected(kind)).length === 0 ? (
          <p className="text-xs text-fg-muted">
            {data.canManage
              ? t("Connect Telegram or Slack for the team below, then link your own chat here.")
              : t(
                  "An admin of the team connects Telegram or Slack first; then you can link yours here.",
                )}
          </p>
        ) : (
          <ul className="grid gap-2">
            {(["telegram", "slack"] as const)
              .filter((kind) => connected(kind))
              .map((kind) => {
                const mine = me.find((link) => link.kind === kind);
                return (
                  <li
                    key={kind}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
                  >
                    <span className="w-20 font-medium">{SERVICE[kind]}</span>
                    {mine ? (
                      <>
                        <span className="flex-1 text-xs text-fg-secondary">
                          {mine.label ? t("Linked as {label}", { label: mine.label }) : t("Linked")}
                        </span>
                        <UnlinkButton
                          teamId={teamId}
                          linkId={mine.id}
                          onDone={keep}
                          onError={failed}
                        />
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-xs text-fg-muted">{t("Not linked")}</span>
                        {linking?.kind !== kind && !(kind === "slack" && askingSlack) && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={startLink.isPending}
                            onClick={() => {
                              if (kind === "slack") {
                                setSlackEmail(user?.email ?? "");
                                setAskingSlack(true);
                                setError(null);
                              } else startLink.mutate({ kind });
                            }}
                          >
                            {t("Link my {kind}", { kind: SERVICE[kind] })}
                          </Button>
                        )}
                      </>
                    )}
                    {kind === "slack" && askingSlack && !mine && linking?.kind !== "slack" && (
                      <form
                        className="grid w-full gap-2 border-t border-border-default pt-2 text-xs"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (slackEmail.trim())
                            startLink.mutate({ kind: "slack", slackEmail: slackEmail.trim() });
                        }}
                      >
                        <label htmlFor="slack-email" className="text-fg-secondary">
                          {t(
                            "The email your Slack account uses. Zelyq sends a code to that account’s direct messages; typing it here proves the account is yours.",
                          )}
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            id="slack-email"
                            type="email"
                            required
                            value={slackEmail}
                            onChange={(event) => setSlackEmail(event.target.value)}
                            placeholder="you@example.com"
                            className="w-72 max-w-full"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            disabled={startLink.isPending}
                          >
                            {startLink.isPending ? t("Sending…") : t("Send me a code")}
                          </Button>
                          <Button type="button" size="sm" onClick={() => setAskingSlack(false)}>
                            {t("Cancel")}
                          </Button>
                        </div>
                      </form>
                    )}
                    {linking?.kind === kind && !mine && (
                      <LinkSteps
                        teamId={teamId}
                        start={linking}
                        onLinked={(next) => {
                          keep(next);
                          setLinking(null);
                          setNotice(
                            t("{kind} is linked. Alerts will arrive there.", {
                              kind: SERVICE[kind],
                            }),
                          );
                        }}
                        onError={failed}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        )}
        {data.channels.some((row) => row.teamAudiences !== null) && (
          <ul className="grid gap-2" aria-label={t("The team’s channels")}>
            {data.channels
              .filter((row) => row.teamAudiences !== null)
              .map((row) => (
                <li
                  key={`team-${row.kind}`}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
                >
                  <span className="w-20 font-medium">{SERVICE[row.kind]}</span>
                  <span className="min-w-0 flex-1 text-xs text-fg-secondary">
                    {row.kind === "discord" ? row.name.replace(/^Discord · /, "") : row.teamChat}{" "}
                    {t("is the team’s channel: everyone there sees ")}
                    {teamAudienceWords(row.teamAudiences ?? [])}
                    {t(". Nothing to link.")}
                  </span>
                </li>
              ))}
          </ul>
        )}
        <Choices
          teamId={teamId}
          prefs={data.prefs}
          available={["email", ...(["telegram", "slack"] as const).filter((k) => connected(k))]}
          onSaved={(next) => {
            keep(next);
            setNotice(t("Saved."));
          }}
          onError={failed}
        />
      </section>

      <section aria-label={t("The team’s services")} className="grid gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("The team’s services")}</h2>
          <p className="text-xs text-fg-secondary">
            {data.canManage
              ? t(
                  "Connect each once for the whole team. Tokens are kept encrypted and are never shown again.",
                )
              : t("Connected by an admin of the team.")}
          </p>
        </div>
        {(["telegram", "slack", "discord"] as const).map((kind) => (
          <ServiceCard
            key={kind}
            teamId={teamId}
            kind={kind}
            channel={connected(kind) ?? null}
            canManage={data.canManage}
            // A test goes to the admin's own linked chat (or Slack's team channel, or Discord's webhook).
            canTest={
              kind === "discord" ||
              me.some((link) => link.kind === kind) ||
              (kind === "slack" && Boolean(connected(kind)?.teamChat))
            }
            onDone={keep}
            onSaid={(words) => {
              setError(null);
              setNotice(words);
            }}
            onError={failed}
          />
        ))}
      </section>

      {data.canManage && data.links.length > 0 && (
        <section aria-label={t("Linked people")} className="grid gap-2">
          <h2 className="text-sm font-medium">{t("Who is linked")}</h2>
          <ul className="divide-y divide-border-default rounded-md border border-border-default bg-surface">
            {data.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-xs">
                <span className="w-20">{SERVICE[link.kind]}</span>
                <span className="flex-1">
                  {link.userName}
                  {link.label ? <span className="text-fg-muted"> — {link.label}</span> : null}
                </span>
                <UnlinkButton teamId={teamId} linkId={link.id} onDone={keep} onError={failed} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function UnlinkButton({
  teamId,
  linkId,
  onDone,
  onError,
}: {
  teamId: string;
  linkId: string;
  onDone: (next: OpsChannelsView) => void;
  onError: (caught: unknown) => void;
}) {
  const unlink = useMutation({
    mutationFn: () => api.ops.unlink(teamId, linkId),
    onSuccess: onDone,
    onError,
  });
  return (
    <button
      type="button"
      disabled={unlink.isPending}
      onClick={() => unlink.mutate()}
      className="text-xs text-fg-secondary hover:underline"
    >
      {t("Unlink")}
    </button>
  );
}

function LinkSteps({
  teamId,
  start,
  onLinked,
  onError,
}: {
  teamId: string;
  start: OpsLinkStart;
  onLinked: (next: OpsChannelsView) => void;
  onError: (caught: unknown) => void;
}) {
  const [code, setCode] = useState("");
  const confirm = useMutation({
    mutationFn: () => api.ops.confirmSlack(teamId, code),
    onSuccess: onLinked,
    onError,
  });
  return (
    <div className="grid w-full gap-2 border-t border-border-default pt-2 text-xs">
      <p className="text-fg-secondary">{start.words}</p>
      {start.kind === "telegram" && start.url && (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={start.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {t("Open Telegram")} <ExternalLink size={12} />
          </a>
          <span className="text-fg-muted">
            {t("or send {code}", {
              code: <code className="rounded bg-surface-hover px-1">/start {start.code}</code>,
            })}
          </span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <Spinner /> {t("waiting for Telegram…")}
          </span>
        </div>
      )}
      {start.kind === "slack" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) confirm.mutate();
          }}
        >
          <Input
            aria-label={t("Code from Slack")}
            placeholder={t("Code from Slack")}
            value={code}
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value)}
            className="w-40 uppercase"
          />
          <Button
            size="sm"
            variant="primary"
            type="submit"
            disabled={confirm.isPending || !code.trim()}
          >
            {t("Link")}
          </Button>
        </form>
      )}
    </div>
  );
}

function Choices({
  teamId,
  prefs,
  available,
  onSaved,
  onError,
}: {
  teamId: string;
  prefs: OpsNotifyPrefs;
  available: OpsPersonalChannel[];
  onSaved: (next: OpsChannelsView) => void;
  onError: (caught: unknown) => void;
}) {
  const [draft, setDraft] = useState<OpsNotifyPrefs>(prefs);
  useEffect(() => {
    setDraft({
      ...prefs,
      // A person who never chose a zone gets their browser's, not UTC.
      timeZone: prefs.quietFrom ? prefs.timeZone : browserZone(),
    });
  }, [prefs]);
  const save = useMutation({
    mutationFn: () => api.ops.setNotify(teamId, draft),
    onSuccess: onSaved,
    onError,
  });
  const toggle = (audience: OpsNotifyAudience, kind: OpsPersonalChannel) =>
    setDraft((current) => ({
      ...current,
      [audience]: current[audience].includes(kind)
        ? current[audience].filter((one) => one !== kind)
        : [...current[audience], kind],
    }));
  const changed = JSON.stringify(draft) !== JSON.stringify(prefs);
  const label = (kind: OpsPersonalChannel) => (kind === "email" ? t("Email") : SERVICE[kind]);

  return (
    <div className="grid gap-3 rounded-md border border-border-default bg-surface p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="py-1 font-normal">{t("What")}</th>
            {available.map((kind) => (
              <th key={kind} className="w-20 py-1 text-center font-normal">
                {label(kind)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AUDIENCE.map((row) => (
            <tr key={row.key} className="border-t border-border-default">
              <td className="py-1.5">
                <span className="font-medium">{row.words}</span>{" "}
                <span className="text-fg-muted">— {row.hint}</span>
              </td>
              {available.map((kind) => (
                <td key={kind} className="text-center">
                  <input
                    type="checkbox"
                    aria-label={t("{words} by {kind}", { words: row.words, kind: label(kind) })}
                    checked={draft[row.key].includes(kind)}
                    onChange={() => toggle(row.key, kind)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="grid gap-1">
          <FieldLabel>{t("Quiet from")}</FieldLabel>
          <Input
            aria-label={t("Quiet from")}
            type="time"
            value={draft.quietFrom ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, quietFrom: event.target.value || null }))
            }
            className="w-28"
          />
        </div>
        <div className="grid gap-1">
          <FieldLabel>{t("Until")}</FieldLabel>
          <Input
            aria-label={t("Quiet until")}
            type="time"
            value={draft.quietTo ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, quietTo: event.target.value || null }))
            }
            className="w-28"
          />
        </div>
        <div className="grid gap-1">
          <FieldLabel>{t("Time zone")}</FieldLabel>
          <Input
            aria-label={t("Time zone")}
            value={draft.timeZone}
            onChange={(event) =>
              setDraft((current) => ({ ...current, timeZone: event.target.value }))
            }
            className="w-44"
          />
        </div>
        <p className="flex-1 text-fg-muted">
          {t("In quiet hours only urgent alerts reach you, by chat or email.")}
        </p>
        <Button
          size="sm"
          variant="primary"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          {t("Save choices")}
        </Button>
      </div>
    </div>
  );
}

function ServiceCard({
  teamId,
  kind,
  channel,
  canManage,
  canTest,
  onDone,
  onSaid,
  onError,
}: {
  teamId: string;
  kind: OpsChannelKind;
  channel: OpsChannelView | null;
  canManage: boolean;
  canTest: boolean;
  onDone: (next: OpsChannelsView) => void;
  onSaid: (words: string) => void;
  onError: (caught: unknown) => void;
}) {
  const [secret, setSecret] = useState("");
  const [teamChat, setTeamChat] = useState("");
  const connect = useMutation({
    mutationFn: () =>
      api.ops.connectChannel(
        teamId,
        kind,
        kind === "discord"
          ? { webhook: secret }
          : { token: secret, ...(kind === "slack" ? { teamChat: teamChat || null } : {}) },
      ),
    onSuccess: (next) => {
      setSecret("");
      setTeamChat("");
      onDone(next);
      onSaid(`${SERVICE[kind]} is connected.`);
    },
    onError,
  });
  const test = useMutation({
    mutationFn: () => api.ops.testChannel(teamId, kind),
    onSuccess: (next) => {
      onDone(next);
      onSaid(`Test sent to ${next.went.join(" and ")}.`);
    },
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => api.ops.disconnectChannel(teamId, kind),
    onSuccess: (next) => {
      onDone(next);
      onSaid(`${SERVICE[kind]} is disconnected; its linked chats are forgotten.`);
    },
    onError,
  });

  return (
    <div className="rounded-md border border-border-default bg-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-20 font-medium">{SERVICE[kind]}</span>
        {channel ? (
          <>
            <span className="min-w-0 flex-1 text-xs text-fg-secondary">
              {channel.name}{" "}
              {channel.status === "ok" ? (
                <Badge tone="success">{t("working")}</Badge>
              ) : (
                <Badge tone="danger">{t("failing")}</Badge>
              )}
              {channel.status !== "ok" && channel.lastError && (
                <span className="block text-danger">{channel.lastError}</span>
              )}
            </span>
            {canManage && (
              <>
                {canTest ? (
                  <Button
                    size="sm"
                    icon={<Send size={13} />}
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                  >
                    {t("Send a test")}
                  </Button>
                ) : (
                  <span className="text-xs text-fg-muted">
                    {t('To send a test, first press "Link my {kind}" at the top of this tab.', {
                      kind: SERVICE[kind],
                    })}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  disabled={disconnect.isPending}
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: t("Disconnect {kind}?", { kind: SERVICE[kind] }),
                        description: t("Everyone’s linked chats there are forgotten."),
                        confirmLabel: t("Disconnect"),
                        danger: true,
                      })
                    )
                      disconnect.mutate();
                  }}
                >
                  {t("Disconnect")}
                </Button>
              </>
            )}
          </>
        ) : (
          <span className="flex-1 text-xs text-fg-muted">{t("Not connected")}</span>
        )}
      </div>
      {channel?.teamAudiences && (
        <TeamAudiences
          teamId={teamId}
          kind={kind}
          chosen={channel.teamAudiences}
          canManage={canManage}
          where={
            kind === "discord"
              ? t("The Discord channel")
              : t("The Slack channel {teamChat}", { teamChat: channel.teamChat })
          }
          onDone={onDone}
          onError={onError}
        />
      )}
      {!channel && canManage && (
        <form
          className="mt-2 grid gap-2 border-t border-border-default pt-2 text-xs"
          onSubmit={(event) => {
            event.preventDefault();
            if (secret.trim()) connect.mutate();
          }}
        >
          <ol className="list-decimal space-y-0.5 pl-4 text-fg-secondary">
            {kind === "telegram" && (
              <>
                <li>
                  {t("In Telegram, open {strong}, send {code} and follow its two questions.", {
                    strong: <b>{t("@BotFather")}</b>,
                    code: <code>/newbot</code>,
                  })}
                </li>
                <li>{t("Paste the token it gives you here (it reads like 123456:ABC…).")}</li>
              </>
            )}
            {kind === "slack" && (
              <>
                <li>
                  {t(
                    "At api.slack.com/apps choose Create New App → From a manifest, and paste the manifest below.",
                  )}
                </li>
                <li>
                  {t("Install it to your workspace and copy the Bot User OAuth Token (xoxb-…).")}
                </li>
                <li>
                  {t(
                    "Optionally name a channel for the whole team (#ops) and invite the bot there with {code}.",
                    { code: <code>/invite @Zelyq</code> },
                  )}
                </li>
              </>
            )}
            {kind === "discord" && (
              <li>
                {t(
                  "In your Discord channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL, and paste it here. Alerts go to that channel for the whole team.",
                )}
              </li>
            )}
          </ol>
          {kind === "slack" && (
            <details>
              <summary className="cursor-pointer text-fg-secondary">{t("The manifest")}</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-surface-hover p-2 text-2xs">
                {SLACK_MANIFEST}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput
              aria-label={
                kind === "discord"
                  ? t("Discord webhook address")
                  : t("{kind} bot token", { kind: SERVICE[kind] })
              }
              placeholder={
                kind === "discord" ? "https://discord.com/api/webhooks/…" : t("Bot token")
              }
              value={secret}
              autoComplete="off"
              onChange={(event) => setSecret(event.target.value)}
              className="w-80 max-w-full"
            />
            {kind === "slack" && (
              <Input
                aria-label={t("Team channel (optional)")}
                placeholder={t("#ops (optional)")}
                value={teamChat}
                onChange={(event) => setTeamChat(event.target.value)}
                className="w-36"
              />
            )}
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={connect.isPending || !secret.trim()}
            >
              {connect.isPending ? t("Checking…") : t("Connect {kind}", { kind: SERVICE[kind] })}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

const TEAM_AUDIENCE_WORDS: Record<OpsTeamAudience, string> = {
  urgent: t("urgent alerts"),
  warning: "warnings",
};

function teamAudienceWords(chosen: OpsTeamAudience[]): string {
  if (chosen.length === 0) return t("nothing for now");
  return chosen.map((one) => TEAM_AUDIENCE_WORDS[one]).join(" and ");
}

/** What the team's shared channel hears: an admin ticks, everyone reads. */
function TeamAudiences({
  teamId,
  kind,
  chosen,
  canManage,
  where,
  onDone,
  onError,
}: {
  teamId: string;
  kind: OpsChannelKind;
  chosen: OpsTeamAudience[];
  canManage: boolean;
  where: string;
  onDone: (next: OpsChannelsView) => void;
  onError: (caught: unknown) => void;
}) {
  const save = useMutation({
    mutationFn: (next: OpsTeamAudience[]) => api.ops.setTeamAudiences(teamId, kind, next),
    onSuccess: onDone,
    onError,
  });
  return (
    <fieldset className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-default pt-2 text-xs">
      <legend className="sr-only">
        {t("What")} {where.toLowerCase()} {t("hears")}
      </legend>
      <span className="text-fg-secondary">{t("{where} hears:", { where })}</span>
      {OPS_TEAM_AUDIENCES.map((one) => (
        <label key={one} className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={chosen.includes(one)}
            disabled={!canManage || save.isPending}
            onChange={(event) =>
              save.mutate(
                event.target.checked ? [...chosen, one] : chosen.filter((other) => other !== one),
              )
            }
          />
          {TEAM_AUDIENCE_WORDS[one].replace(/^./, (first) => first.toUpperCase())}
        </label>
      ))}
      <span className="text-fg-muted">
        {t("Approvals and messages Ops sends you stay in your own chats.")}
      </span>
    </fieldset>
  );
}
