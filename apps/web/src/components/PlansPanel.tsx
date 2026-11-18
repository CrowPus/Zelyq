import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PLAN_LIMIT_KEYS, PLAN_LIMITS, type Plan, type PlanLimitKey } from "@zelyq/core";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { IdleCleanup } from "./IdleCleanup";
import { sizeWords } from "./UsagePanel";
import { Button, Input, NativeSelect, Spinner } from "./ui";

/**
 * The server's plans: what each lets a team use, which a new team starts on,
 * and which plan each team is on. Unlimited always exists; teams a server
 * admin belongs to stay on it unless put on a plan here.
 */
let nextUid = 0;
function withUid(plan: Plan): Plan & { uid: string } {
  nextUid += 1;
  return { ...plan, uid: `p${nextUid}` };
}

export function PlansPanel() {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.plans });
  const teams = useQuery({ queryKey: ["plan-teams"], queryFn: api.planTeams });
  // Each plan in the form carries its own key, so editing its id never resets the row.
  const [draft, setDraft] = useState<Array<Plan & { uid: string }> | null>(null);
  const [defaultPlan, setDefaultPlan] = useState("unlimited");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (plans.data && draft === null) {
      setDraft(plans.data.plans.map(withUid));
      setDefaultPlan(plans.data.defaultPlan);
    }
  }, [plans.data, draft]);

  const save = useMutation({
    mutationFn: () =>
      api.savePlans({ plans: (draft ?? []).map(({ uid: _uid, ...plan }) => plan), defaultPlan }),
    onSuccess: (next) => {
      queryClient.setQueryData(["plans"], next);
      void queryClient.invalidateQueries({ queryKey: ["plan-teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team-usage"] });
      setDraft(next.plans.map(withUid));
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (caught) => setError((caught as Error).message),
  });
  const move = useMutation({
    mutationFn: (input: { teamId: string; plan: string }) =>
      api.setTeamPlan(input.teamId, input.plan),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plan-teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team-usage"] });
    },
    onError: (caught) => setError((caught as Error).message),
  });

  if (plans.isLoading || !draft) return <Spinner />;
  const choices = [{ id: "unlimited", name: "Unlimited" }, ...draft];
  const setLimit = (index: number, key: PlanLimitKey, raw: string) =>
    setDraft((current) =>
      (current ?? []).map((plan, at) =>
        at === index
          ? {
              ...plan,
              limits: {
                ...plan.limits,
                [key]: raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)),
              },
            }
          : plan,
      ),
    );

  return (
    <section className="mt-7" aria-label="Plans">
      <h2 className="text-sm font-medium text-fg">Plans</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">
        What each team may use. A limit left empty is no limit. At a limit only something new is
        stopped (a new app, upload or run); nothing that exists is broken or deleted. Unlimited
        always exists, and the teams you belong to stay on it unless you move them here.
      </p>

      <div className="mt-3 grid gap-3">
        {draft.map((plan, index) => (
          <div key={plan.uid} className="rounded-lg border border-border-default bg-surface p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1 text-2xs text-fg-secondary">
                <span>Name</span>
                <Input
                  value={plan.name}
                  aria-label="Plan name"
                  onChange={(event) =>
                    setDraft((current) =>
                      (current ?? []).map((one, at) =>
                        at === index ? { ...one, name: event.target.value } : one,
                      ),
                    )
                  }
                  className="w-40"
                />
              </div>
              <div className="grid gap-1 text-2xs text-fg-secondary">
                <span>Id</span>
                <Input
                  value={plan.id}
                  aria-label="Plan id"
                  onChange={(event) =>
                    setDraft((current) =>
                      (current ?? []).map((one, at) =>
                        at === index ? { ...one, id: event.target.value.toLowerCase() } : one,
                      ),
                    )
                  }
                  className="w-32 font-mono"
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                icon={<Trash2 size={12} />}
                onClick={() =>
                  setDraft((current) => (current ?? []).filter((_, at) => at !== index))
                }
              >
                Remove
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {PLAN_LIMIT_KEYS.map((key) => (
                <div
                  key={key}
                  className="grid gap-1 text-2xs text-fg-secondary"
                  title={PLAN_LIMITS[key].description}
                >
                  <span>
                    {PLAN_LIMITS[key].label}
                    {PLAN_LIMITS[key].unit ? ` (${PLAN_LIMITS[key].unit})` : ""}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    placeholder="No limit"
                    aria-label={`${plan.name} ${PLAN_LIMITS[key].label}`}
                    value={plan.limits[key] ?? ""}
                    onChange={(event) => setLimit(index, key, event.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          icon={<Plus size={12} />}
          onClick={() =>
            setDraft((current) => [
              ...(current ?? []),
              withUid({ id: `plan-${(current?.length ?? 0) + 1}`, name: "New plan", limits: {} }),
            ])
          }
        >
          Add a plan
        </Button>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          New teams start on
          <NativeSelect
            aria-label="Plan new teams start on"
            value={defaultPlan}
            onChange={(event) => setDefaultPlan(event.target.value)}
          >
            {choices.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : saved ? "Saved" : "Save plans"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <h3 className="mt-6 text-sm font-medium text-fg">Teams</h3>
      <div className="mt-2 overflow-hidden rounded-lg border border-border-default bg-surface">
        {(teams.data?.teams ?? []).map((team) => (
          <div
            key={team.id}
            className="flex flex-wrap items-center gap-3 border-b border-border-default px-4 py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-fg">{team.name}</span>
            <span className="text-2xs text-fg-muted">
              {sizeWords(team.storageMb)} · {team.apps} apps · {team.members} members
            </span>
            <NativeSelect
              aria-label={`Plan for ${team.name}`}
              value={team.plan.id}
              disabled={move.isPending}
              onChange={(event) => move.mutate({ teamId: team.id, plan: event.target.value })}
            >
              {(plans.data?.all ?? choices).map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
        {teams.isLoading && (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        )}
      </div>
      <IdleCleanup />
    </section>
  );
}
