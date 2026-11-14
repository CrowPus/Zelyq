import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLE_DESCRIPTIONS, ROLES, type Role, roleAtLeast } from "@zelyq/core";
import { CircleAlert, CircleCheck, Mail, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Input, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../lib/audit";

export function TeamPage() {
  const { id = "" } = useParams();
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
          ? `Invitation sent to ${result.invited}. They join when they open the link.`
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
    <AppShell crumbs={[{ label: "Teams", to: "/" }, { label: team?.name ?? "Team" }]}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-fg">{team?.name ?? "Team"}</h1>
              <p className="mt-1 text-xs text-fg-secondary">
                Everyone here sees every app in this team. What they may change depends on their
                role.
              </p>
            </div>
            {team && <Badge tone="neutral">{team.role}</Badge>}
          </header>

          {canManage && (
            <form
              onSubmit={submit}
              className="mt-6 flex flex-col gap-2 rounded-lg border border-border-default bg-surface p-3 sm:flex-row sm:items-center"
            >
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={canInvite ? "Email address" : "Email of an existing account"}
                aria-label="Email"
                className="sm:flex-1"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                aria-label="Role"
                className="h-[30px] rounded-md border border-border-default bg-surface px-2 text-sm text-fg"
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                variant="primary"
                icon={<UserPlus size={13} strokeWidth={1.75} />}
                disabled={addMember.isPending || !email.trim()}
              >
                {canInvite ? "Add or invite" : "Add"}
              </Button>
            </form>
          )}

          {canManage && (
            <p className="mt-2 text-2xs text-fg-muted">
              {canInvite
                ? "Someone with an account joins straight away. Anyone else gets an invitation email, valid for 7 days."
                : "Only people who already have an account can be added. To invite anyone by email, an instance admin turns on invitations in Settings → Email."}
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

          <div className="mt-6 overflow-hidden rounded-lg border border-border-default bg-surface">
            <div className="grid grid-cols-[minmax(0,1fr)_130px_70px] items-center gap-3 border-b border-border-default bg-surface-subtle px-4 py-2 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
              <span>Member</span>
              <span>Role</span>
              <span />
            </div>

            {members.isLoading && (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                <Spinner /> Loading members…
              </div>
            )}

            {members.data?.members.map((member) => (
              <div
                key={member.userId}
                className="grid grid-cols-[minmax(0,1fr)_130px_70px] items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">
                    {member.name}
                    {member.userId === user?.id && (
                      <span className="ml-1.5 text-xs text-fg-muted">(you)</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-2xs text-fg-muted">{member.email}</p>
                </div>

                {canManage ? (
                  <select
                    value={member.role}
                    onChange={(event) =>
                      changeRole.mutate({ userId: member.userId, next: event.target.value as Role })
                    }
                    aria-label={`Role for ${member.name}`}
                    title={ROLE_DESCRIPTIONS[member.role]}
                    className="h-[26px] rounded-md border border-border-default bg-surface px-1.5 text-xs text-fg"
                  >
                    {ROLES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="text-xs text-fg-secondary"
                    title={ROLE_DESCRIPTIONS[member.role]}
                  >
                    {member.role}
                  </span>
                )}

                <div className="text-right">
                  {(canManage || member.userId === user?.id) && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeMember.mutate(member.userId)}
                    >
                      {member.userId === user?.id ? "Leave" : "Remove"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canManage && (invites.data?.invites.length ?? 0) > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
                Waiting to join
              </h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
                {invites.data?.invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center gap-3 border-b border-border-default px-4 py-2.5 last:border-b-0"
                  >
                    <Mail size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-fg">{invite.email}</p>
                      <p className="truncate text-2xs text-fg-muted">
                        {invite.role} · invited
                        {invite.invitedBy ? ` by ${invite.invitedBy}` : ""} · link works until{" "}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(invite.id)}
                    >
                      Withdraw
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManage && (
            <div className="mt-6">
              <h2 className="text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
                Who changed what
              </h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
                {auditLog.isLoading && (
                  <div className="flex items-center gap-2 px-4 py-6 text-xs text-fg-muted">
                    <Spinner /> Loading history…
                  </div>
                )}
                {auditLog.data && auditLog.data.entries.length === 0 && (
                  <p className="px-4 py-6 text-xs text-fg-muted">Nothing recorded yet.</p>
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
                        <span className="truncate font-mono text-2xs text-fg-muted">{detail}</span>
                      )}
                      <span className="ml-auto shrink-0 text-2xs text-fg-muted">
                        {new Date(entry.createdAt).toLocaleString()}
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
                <dt className="w-14 shrink-0 font-medium text-fg">{option}</dt>
                <dd className="text-fg-secondary">{ROLE_DESCRIPTIONS[option]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </AppShell>
  );
}
