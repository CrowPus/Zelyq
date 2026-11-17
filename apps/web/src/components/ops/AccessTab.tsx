import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OPS_SEE_ONLY_KINDS,
  OPS_TRUST_WORDS,
  type OpsAccessItem,
  type OpsAccessKind,
} from "@zelyq/core";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { Badge, NativeSelect, Spinner } from "../ui";

/**
 * What Ops has been given (076). Nothing is given at first: Ops does not see,
 * watch or touch anything until a team admin assigns it here.
 */

const SECTIONS: { kind: OpsAccessKind; title: string; hint: string; empty: string }[] = [
  {
    kind: "environment",
    title: "Environments",
    hint: "Where apps run. To change one, Ops also follows the trust level you choose.",
    empty: "No environments in this team yet.",
  },
  {
    kind: "machine",
    title: "Machines",
    hint: "The servers. Looking: disk, memory, ports. Managing: putting new environments on it.",
    empty: "No machines in this team yet.",
  },
  {
    kind: "pipeline",
    title: "Pipelines",
    hint: "Managing lets Ops run and change it. It still needs the environments it deploys to.",
    empty: "No pipelines in this team yet.",
  },
  {
    kind: "project",
    title: "Apps' code",
    hint: "Ops reads the code to learn how an app is built and what it needs. It never changes code.",
    empty: "No apps in this team yet.",
  },
  {
    kind: "vault",
    title: "Secrets",
    hint: "Ops only ever sees secret names, to tell you which are missing. Never their values.",
    empty: "",
  },
];

/** One choice per row: what Ops may do with this thing. */
type Choice = "none" | "see" | "manage" | "ask" | "trusted" | "oncall";

function choiceOf(item: OpsAccessItem): Choice {
  if (!item.level) return "none";
  if (item.kind !== "environment" || item.level === "see") return item.level;
  // An environment Ops manages at "advise only" can do no more than look.
  return item.trust === "advise" ? "see" : (item.trust ?? "ask");
}

function choicesFor(kind: OpsAccessKind): { value: Choice; label: string }[] {
  if (kind === "environment") {
    return [
      { value: "none", label: "No access" },
      { value: "see", label: "Look only" },
      { value: "ask", label: `Manage: ${OPS_TRUST_WORDS.ask.label.toLowerCase()}` },
      { value: "trusted", label: `Manage: ${OPS_TRUST_WORDS.trusted.label.toLowerCase()}` },
      { value: "oncall", label: `Manage: ${OPS_TRUST_WORDS.oncall.label.toLowerCase()}` },
    ];
  }
  if (OPS_SEE_ONLY_KINDS.includes(kind)) {
    return [
      { value: "none", label: "No access" },
      { value: "see", label: kind === "vault" ? "Names only" : "Look only" },
    ];
  }
  return [
    { value: "none", label: "No access" },
    { value: "see", label: "Look only" },
    { value: "manage", label: "Manage" },
  ];
}

const CHOICE_WORDS: Partial<Record<Choice, string>> = {
  none: "Ops cannot see this.",
  see: "Ops can look and advise, never change it.",
  manage: "Ops can change it, as a step in a plan.",
  ask: OPS_TRUST_WORDS.ask.description,
  trusted: OPS_TRUST_WORDS.trusted.description,
  oncall: OPS_TRUST_WORDS.oncall.description,
};

export function AccessTab({ teamId, isAdmin }: { teamId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const access = useQuery({
    queryKey: ["ops-access", teamId],
    queryFn: () => api.ops.access(teamId),
  });
  const change = useMutation({
    mutationFn: (input: { item: OpsAccessItem; choice: Choice }) => {
      const { item, choice } = input;
      const trust = choice === "ask" || choice === "trusted" || choice === "oncall" ? choice : null;
      return api.ops.setAccess(teamId, {
        kind: item.kind,
        resourceId: item.id,
        level: choice === "none" ? null : choice === "see" ? "see" : "manage",
        ...(trust ? { trust } : {}),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["ops-access", teamId], data);
      setError(null);
    },
    onError: (caught) => setError((caught as Error).message),
  });

  if (access.isLoading) return <Spinner />;
  const items = access.data?.items ?? [];
  const given = items.filter((item) => item.level !== null).length;

  return (
    <div className="grid max-w-3xl gap-6">
      <section className="flex items-start gap-3 rounded-md border border-border-default bg-surface-subtle p-3">
        <ShieldCheck size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-muted" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {given === 0
              ? "Ops has not been given anything yet"
              : `Ops has been given ${given} thing${given === 1 ? "" : "s"}`}
          </p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            Ops sees, watches and changes only what is given here. Everything else does not exist
            for it, and it cannot give itself anything.
            {isAdmin ? "" : " Only a team admin changes this."} Deleting data, pointing domains and
            anything that cannot be undone still wait for a person, whatever you choose.
          </p>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {SECTIONS.map((section) => {
        const rows = items.filter((item) => item.kind === section.kind);
        return (
          <section key={section.kind} className="grid gap-2">
            <div>
              <h2 className="text-sm font-medium">{section.title}</h2>
              <p className="text-xs text-fg-secondary">{section.hint}</p>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-fg-muted">{section.empty}</p>
            ) : (
              <ul className="grid gap-2">
                {rows.map((item) => {
                  const choice = choiceOf(item);
                  return (
                    <li
                      key={`${item.kind}:${item.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-default px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{item.name}</span>
                          {item.protected && <Badge tone="warning">Protected</Badge>}
                          {item.frozen && <Badge tone="danger">Frozen</Badge>}
                        </p>
                        {item.detail && (
                          <p className="truncate text-2xs text-fg-muted">{item.detail}</p>
                        )}
                      </div>
                      <NativeSelect
                        aria-label={`What Ops may do with ${item.name}`}
                        value={choice}
                        disabled={!isAdmin || change.isPending}
                        onChange={(event) =>
                          change.mutate({ item, choice: event.target.value as Choice })
                        }
                        className={`w-auto ${choice === "none" ? "text-fg-muted" : "text-fg"}`}
                      >
                        {choicesFor(item.kind).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                      <p className="w-full text-2xs text-fg-muted">{CHOICE_WORDS[choice]}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
