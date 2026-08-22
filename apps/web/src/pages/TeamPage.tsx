import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, ROLE_DESCRIPTIONS, type Role, roleAtLeast } from "@zelyq/core";
import { CircleAlert, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Input, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

export function TeamPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { user, teams } = useSession();
  const team = teams.find((candidate) => candidate.id === id);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ["members", id], queryFn: () => api.listMembers(id) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members", id] });

  const addMember = useMutation({
    mutationFn: () => api.addMember(id, { email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      setError(null);
      invalidate();
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
                Everyone here sees every project in this team. What they may change depends on their
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
                placeholder="Email of an existing account"
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
                Add
              </Button>
            </form>
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
