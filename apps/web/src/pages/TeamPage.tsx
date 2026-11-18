import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLE_DESCRIPTIONS, ROLES, type Role, roleAtLeast } from "@zelyq/core";
import { ChevronRight, CircleAlert, CircleCheck, Mail, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { MembersTable } from "../components/MembersTable";
import {
  Badge,
  Button,
  confirmAction,
  Input,
  NativeSelect,
  PageBody,
  PageHeader,
  RelativeTime,
  Spinner,
} from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../lib/audit";
import { formatDate } from "../lib/format";
import { t, translateServerMessage } from "../lib/i18n";
import { roleName } from "../lib/roles";
import { globalPaths, teamHref, useRouteTeam } from "../lib/routes";

export function TeamPage() {
  const id = useRouteTeam()?.id ?? "";
  const queryClient = useQueryClient();
  const { user, teams } = useSession();
  const team = teams.find((candidate) => candidate.id === id);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const members = useQuery({ queryKey: ["members", id], queryFn: () => api.listMembers(id) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members", id] });

  const addMember = useMutation({
    mutationFn: () => api.addMember(id, { email: email.trim(), role }),
    onSuccess: (result) => {
      setEmail("");
      setError(null);
      setNotice(
        result.invited
          ? t("Invitation sent to {invited}. They join when they open the link.", {
              invited: result.invited,
            })
          : null,
      );
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["invites", id] });
      queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
    },
    onError: (caught) => {
      setNotice(null);
      setError((caught as Error).message);
    },
  });

  const withdraw = useMutation({
    mutationFn: (inviteId: string) => api.withdrawInvite(id, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", id] });
      queryClient.invalidateQueries({ queryKey: ["audit-log", id] });
    },
    onError: (caught) => setError((caught as Error).message),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: Role }) =>
      api.updateMemberRole(id, userId, next),
    onSuccess: invalidate,
    onError: (caught) => setError((caught as Error).message),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(id, userId),
    onSuccess: invalidate,
    onError: (caught) => setError((caught as Error).message),
  });

  const canManage = team ? roleAtLeast(team.role, "admin") : false;

  // The server gates this route the same way, admin or higher — this only
  // decides whether to ask, not whether the answer is trusted.
  const auditLog = useQuery({
    queryKey: ["audit-log", id],
    queryFn: () => api.auditLog(id),
    enabled: canManage,
  });

  // Whether people without an account can be invited by email: only on an instance set up for it.
  const invites = useQuery({
    queryKey: ["invites", id],
    queryFn: () => api.teamInvites(id),
    enabled: canManage,
  });
  const canInvite = invites.data?.canInvite ?? false;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) addMember.mutate();
  }

  return (
    <AppShell crumbs={[{ label: t("Members") }]}>
      <PageBody width="standard">
        <PageHeader
          title={t("Members")}
          description={t(
            "Everyone in {name} sees every app in it. What they may change depends on their role.",
            { name: team?.name ?? t("this team") },
          )}
          meta={
            team && (
              <Badge tone="neutral">
                {t(
                  "{role, select, owner {You are the owner} admin {You are an admin} editor {You are an editor} viewer {You are a viewer} other {Your role: {role}}}",
                  { role: team.role },
                )}
              </Badge>
            )
          }
        />

        {canManage && (
          <form
            onSubmit={submit}
            className="mt-6 flex flex-col gap-2 rounded-lg border border-border-default bg-surface p-3 sm:flex-row sm:items-center"
          >
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={canInvite ? t("Email address") : t("Email of an existing account")}
              aria-label={t("Email")}
              className="sm:flex-1"
            />
            <NativeSelect
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              aria-label={t("Role")}
              className="w-auto shrink-0"
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {roleName(option)}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="submit"
              variant="primary"
              icon={<UserPlus size={13} strokeWidth={1.75} />}
              disabled={addMember.isPending || !email.trim()}
            >
              {canInvite ? t("Add or invite") : t("Add")}
            </Button>
          </form>
        )}

        {canManage && (
          <p className="mt-2 text-2xs text-fg-muted">
            {canInvite
              ? t(
                  "Someone with an account joins straight away. Anyone else gets an invitation email, valid for 7 days.",
                )
              : user?.instanceRole === "admin"
                ? t(
                    "Only people who already have an account can be added until email is set up. {link}",
                    {
                      link: (
                        <Link to={globalPaths.admin("email")} className="text-info underline">
                          {t("Set up email")}
                        </Link>
                      ),
                    },
                  )
                : t(
                    "Only people who already have an account can be added. To invite anyone by email, a server admin turns on invitations in Server admin → Email.",
                  )}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="mt-3 flex items-start gap-2 rounded-md border border-success/25 bg-success-subtle px-2.5 py-2 text-xs text-success"
          >
            <CircleCheck size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {notice}
          </p>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-6">
          <MembersTable
            members={members.data?.members ?? []}
            loading={members.isLoading}
            teamKey={id}
            meId={user?.id}
            canManage={canManage}
            onRole={(userId, next) => changeRole.mutate({ userId, next })}
            onRemove={async (member) => {
              const leaving = member.userId === user?.id;
              const ok = await confirmAction({
                title: leaving
                  ? t("Leave {team}?", { team: team?.name ?? t("this team") })
                  : t("Remove {name} from the team?", { name: member.name }),
                description: leaving
                  ? t("You lose access to its apps until someone adds you again.")
                  : t("They lose access to the team’s apps straight away. Their work stays."),
                confirmLabel: leaving ? t("Leave team") : t("Remove"),
                danger: true,
              });
              if (ok) removeMember.mutate(member.userId);
            }}
          />
        </div>

        {team && (
          <Link
            to={teamHref(`/settings`)}
            className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-border-default bg-surface px-4 py-3 hover:bg-surface-hover"
          >
            <span>
              <span className="block text-sm font-medium text-fg">{t("Team settings")}</span>
              <span className="block text-xs text-fg-secondary">
                {t(
                  "AI keys, how apps are built, Studio, voice and Ops: everything this team decides for itself.",
                )}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-fg-muted" />
          </Link>
        )}

        {canManage && (invites.data?.invites.length ?? 0) > 0 && (
          <div className="mt-6">
            <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              {t("Waiting to join")}
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
              {invites.data?.invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
                >
                  <Mail size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{invite.email}</p>
                    <p className="truncate text-2xs text-fg-muted">
                      {invite.invitedBy
                        ? t("{role} · invited by {invitedBy} · link works until {expiresAt}", {
                            role: roleName(invite.role),
                            invitedBy: invite.invitedBy,
                            expiresAt: formatDate(invite.expiresAt),
                          })
                        : t("{role} · invited · link works until {expiresAt}", {
                            role: roleName(invite.role),
                            expiresAt: formatDate(invite.expiresAt),
                          })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(invite.id)}
                  >
                    {t("Withdraw")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {canManage && (
          <div className="mt-6">
            <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              {t("Who changed what")}
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
              {auditLog.isLoading && (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                  <Spinner /> {t("Loading history…")}
                </div>
              )}
              {auditLog.data && auditLog.data.entries.length === 0 && (
                <p className="px-4 py-6 text-xs text-fg-muted">{t("Nothing recorded yet.")}</p>
              )}
              {auditLog.data?.entries.map((entry) => {
                const detail = auditDetailSummary(entry.detail);
                return (
                  <div
                    key={entry.id}
                    className="flex items-baseline gap-2 border-b border-border-default px-4 py-2 text-xs last:border-b-0"
                  >
                    <span className="font-medium text-fg">{entry.actorName}</span>
                    <span className="text-fg-secondary">{AUDIT_ACTION_LABELS[entry.action]}</span>
                    {detail && (
                      <span className="truncate text-xs font-medium text-fg">{detail}</span>
                    )}
                    <span className="ml-auto shrink-0 text-2xs text-fg-muted">
                      <RelativeTime value={entry.createdAt} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <dl className="mt-6 grid gap-2 text-xs">
          {ROLES.map((option) => (
            <div key={option} className="flex gap-2">
              <dt className="w-14 shrink-0 font-medium text-fg">{roleName(option)}</dt>
              <dd className="text-fg-secondary">
                {translateServerMessage(ROLE_DESCRIPTIONS[option])}
              </dd>
            </div>
          ))}
        </dl>
      </PageBody>
    </AppShell>
  );
}
