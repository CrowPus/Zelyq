import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OpsChannelKind,
  OpsChannelsView,
  OpsChannelView,
  OpsLinkStart,
  OpsNotifyAudience,
  OpsNotifyPrefs,
  OpsPersonalChannel,
} from "@zelyq/core";
import { ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, FieldLabel, Input, PasswordInput, Spinner } from "../ui";

/**
 * Where alerts reach people (075 Step 2). Each person links their own
 * Telegram or Slack with a one-time code and chooses what goes where; an admin
 * connects the team's services once. Tokens go in and never come back out.
 */

const SERVICE: Record<OpsChannelKind, string> = {
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
};

const AUDIENCE: Array<{ key: OpsNotifyAudience; words: string; hint: string }> = [
  { key: "urgent", words: "Urgent", hint: "a site or machine is down" },
  { key: "warning", words: "Warnings", hint: "slow, a disk filling, a certificate ending" },
  { key: "approval", words: "Ops needs you", hint: "an approval, a secret, a job finished" },
  { key: "weekly", words: "Weekly report", hint: "how the week went" },
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
      setNotice("Telegram is linked. Alerts will arrive there.");
    }
  }, [data, linking, linkingSince]);

  const startLink = useMutation({
    mutationFn: (kind: OpsChannelKind) => api.ops.startLink(teamId, kind),
    onSuccess: (started) => {
      setLinkingSince(new Date(Date.now() - 5000).toISOString());
      setLinking(started);
      setError(null);
      setNotice(null);
    },
    onError: failed,
  });

  if (view.isLoading) return <Spinner />;
  if (!data) return <p className="text-sm text-danger">This could not be read.</p>;

  const connected = (kind: OpsChannelKind) => data.channels.find((row) => row.kind === kind);
  const me = data.links.filter((link) => link.userId === data.me);

  return (
    <div className="grid gap-8">
      {error && <p className="text-xs text-danger">{error}</p>}
      {notice && <p className="text-xs text-success">{notice}</p>}

      <section aria-label="Your alerts" className="grid gap-3">
        <div>
          <h2 className="text-sm font-medium">Where your alerts reach you</h2>
          <p className="text-xs text-fg-secondary">
            Email always works. Link your own chat to be told there too, then choose what goes
            where.
          </p>
        </div>
        {(["telegram", "slack"] as const).filter((kind) => connected(kind)).length === 0 ? (
          <p className="text-xs text-fg-muted">
            {data.canManage
              ? "Connect Telegram or Slack for the team below, then link your own chat here."
              : "An admin of the team connects Telegram or Slack first; then you can link yours here."}
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
                          Linked{mine.label ? ` as ${mine.label}` : ""}
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
                        <span className="flex-1 text-xs text-fg-muted">Not linked</span>
                        {linking?.kind !== kind && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={startLink.isPending}
                            onClick={() => startLink.mutate(kind)}
                          >
                            Link my {SERVICE[kind]}
                          </Button>
                        )}
                      </>
                    )}
                    {linking?.kind === kind && !mine && (
                      <LinkSteps
                        teamId={teamId}
                        start={linking}
                        onLinked={(next) => {
                          keep(next);
                          setLinking(null);
                          setNotice(`${SERVICE[kind]} is linked. Alerts will arrive there.`);
                        }}
                        onError={failed}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        )}
        <Choices
          teamId={teamId}
          prefs={data.prefs}
          available={["email", ...(["telegram", "slack"] as const).filter((k) => connected(k))]}
          onSaved={(next) => {
            keep(next);
            setNotice("Saved.");
          }}
          onError={failed}
        />
      </section>

      <section aria-label="The team's services" className="grid gap-3">
        <div>
          <h2 className="text-sm font-medium">The team's services</h2>
          <p className="text-xs text-fg-secondary">
            {data.canManage
              ? "Connect each once for the whole team. Tokens are kept encrypted and are never shown again."
              : "Connected by an admin of the team."}
          </p>
        </div>
        {(["telegram", "slack", "discord"] as const).map((kind) => (
          <ServiceCard
            key={kind}
            teamId={teamId}
            kind={kind}
            channel={connected(kind) ?? null}
            canManage={data.canManage}
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
        <section aria-label="Linked people" className="grid gap-2">
          <h2 className="text-sm font-medium">Who is linked</h2>
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
      Unlink
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
            Open Telegram <ExternalLink size={12} />
          </a>
          <span className="text-fg-muted">
            or send <code className="rounded bg-surface-hover px-1">/start {start.code}</code>
          </span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <Spinner /> waiting for Telegram…
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
            aria-label="Code from Slack"
            placeholder="Code from Slack"
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
            Link
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
  const label = (kind: OpsPersonalChannel) => (kind === "email" ? "Email" : SERVICE[kind]);

  return (
    <div className="grid gap-3 rounded-md border border-border-default bg-surface p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="py-1 font-normal">What</th>
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
                    aria-label={`${row.words} by ${label(kind)}`}
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
          <FieldLabel>Quiet from</FieldLabel>
          <Input
            aria-label="Quiet from"
            type="time"
            value={draft.quietFrom ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, quietFrom: event.target.value || null }))
            }
            className="w-28"
          />
        </div>
        <div className="grid gap-1">
          <FieldLabel>Until</FieldLabel>
          <Input
            aria-label="Quiet until"
            type="time"
            value={draft.quietTo ?? ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, quietTo: event.target.value || null }))
            }
            className="w-28"
          />
        </div>
        <div className="grid gap-1">
          <FieldLabel>Time zone</FieldLabel>
          <Input
            aria-label="Time zone"
            value={draft.timeZone}
            onChange={(event) =>
              setDraft((current) => ({ ...current, timeZone: event.target.value }))
            }
            className="w-44"
          />
        </div>
        <p className="flex-1 text-fg-muted">
          In quiet hours only urgent alerts reach your chats; email is not held.
        </p>
        <Button
          size="sm"
          variant="primary"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          Save choices
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
  onDone,
  onSaid,
  onError,
}: {
  teamId: string;
  kind: OpsChannelKind;
  channel: OpsChannelView | null;
  canManage: boolean;
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
                <Badge tone="success">working</Badge>
              ) : (
                <Badge tone="danger">failing</Badge>
              )}
              {channel.status !== "ok" && channel.lastError && (
                <span className="block text-danger">{channel.lastError}</span>
              )}
            </span>
            {canManage && (
              <>
                <Button
                  size="sm"
                  icon={<Send size={13} />}
                  disabled={test.isPending}
                  onClick={() => test.mutate()}
                >
                  Send a test
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={disconnect.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Disconnect ${SERVICE[kind]}? Everyone's linked chats there are forgotten.`,
                      )
                    )
                      disconnect.mutate();
                  }}
                >
                  Disconnect
                </Button>
              </>
            )}
          </>
        ) : (
          <span className="flex-1 text-xs text-fg-muted">Not connected</span>
        )}
      </div>
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
                  In Telegram, open <b>@BotFather</b>, send <code>/newbot</code> and follow its two
                  questions.
                </li>
                <li>Paste the token it gives you here (it reads like 123456:ABC…).</li>
              </>
            )}
            {kind === "slack" && (
              <>
                <li>
                  At api.slack.com/apps choose Create New App → From a manifest, and paste the
                  manifest below.
                </li>
                <li>Install it to your workspace and copy the Bot User OAuth Token (xoxb-…).</li>
                <li>
                  Optionally name a channel for the whole team (#ops) and invite the bot there with{" "}
                  <code>/invite @Zelyq</code>.
                </li>
              </>
            )}
            {kind === "discord" && (
              <li>
                In your Discord channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy
                Webhook URL, and paste it here. Alerts go to that channel for the whole team.
              </li>
            )}
          </ol>
          {kind === "slack" && (
            <details>
              <summary className="cursor-pointer text-fg-secondary">The manifest</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-surface-hover p-2 text-2xs">
                {SLACK_MANIFEST}
              </pre>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput
              aria-label={
                kind === "discord" ? "Discord webhook address" : `${SERVICE[kind]} bot token`
              }
              placeholder={kind === "discord" ? "https://discord.com/api/webhooks/…" : "Bot token"}
              value={secret}
              autoComplete="off"
              onChange={(event) => setSecret(event.target.value)}
              className="w-80 max-w-full"
            />
            {kind === "slack" && (
              <Input
                aria-label="Team channel (optional)"
                placeholder="#ops (optional)"
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
              {connect.isPending ? "Checking…" : `Connect ${SERVICE[kind]}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
