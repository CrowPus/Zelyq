import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./ui";

/**
 * The team decides whether support may look inside its apps (files, to help
 * with a problem), and for how long. Without this, support sees only facts
 * and logs; with it, every look shows in the team's activity.
 */
export function SupportAccessPanel({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["support-access", teamId],
    queryFn: () => api.supportAccess(teamId),
  });
  const change = useMutation({
    mutationFn: async (allow: boolean): Promise<void> => {
      if (allow) await api.allowSupport(teamId, 48);
      else await api.withdrawSupport(teamId);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["support-access", teamId] }),
  });
  const until = access.data?.access?.until ?? null;

  return (
    <section className="mt-8" aria-label="Support access">
      <h2 className="flex items-center gap-2 text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
        <LifeBuoy size={13} aria-hidden /> Support access
      </h2>
      <p className="mt-1 text-xs text-fg-secondary">
        {until
          ? `Support may look inside this team's apps until ${new Date(until).toLocaleString()}. Every look is in the team's activity.`
          : "Support can see this team's facts and logs, not what is inside its apps. To get help with an app, let them look for 48 hours."}
      </p>
      {canManage && (
        <div className="mt-2">
          {until ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={change.isPending}
              onClick={() => change.mutate(false)}
            >
              Take it back now
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={change.isPending}
              onClick={() => change.mutate(true)}
            >
              Let support look for 48 hours
            </Button>
          )}
          {change.isError && (
            <p className="mt-1 text-xs text-danger">{(change.error as Error).message}</p>
          )}
        </div>
      )}
    </section>
  );
}
