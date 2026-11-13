import type { OpsRisk } from "@zelyq/core";
import type { OpsEnvironmentRef } from "./actions.js";

/**
 * The one place that decides what Ops (or an outside agent using Ops's
 * actions) may do (072 §2.6). It takes facts the server gathered and returns
 * a verdict; it never trusts anything the model says about itself.
 *
 * The rules, in order (the first that applies wins):
 *  1. Ops is paused                                   → refuse
 *  2. it changes what Ops itself may do               → refuse (a person does it)
 *  3. it cannot be undone and this step is not confirmed one by one → ask
 *  4. the environment is frozen (and it is not a read) → refuse
 *  5. it only looks                                   → run
 *  6. exactly this was already tried in this job      → refuse
 *  7. it comes from an outside agent                  → ask (outside agents are capped at "ask first")
 *  8. the environment is "advise only"                → refuse (Ops tells the person what to do)
 *  9. an approved, unchanged plan lists exactly this  → run
 * 10. it touches no environment                       → run if the action is free to use, else ask
 * 11. the environment's trust level                   → ask first: run unless protected or serving a live site (it has a domain); trusted, on call: run
 * 12. (after the gate, in the service) every check a lesson switched on → refuse, or ask for a block
 */

export type Verdict =
  | { verdict: "run"; rule: number }
  | { verdict: "ask"; rule: number; reason: string }
  | { verdict: "refuse"; rule: number; reason: string };

export interface GateFacts {
  /** "ops": the team's own engineer. "agent": an outside agent through MCP. */
  actor: "ops" | "agent";
  paused: boolean;
  risk: OpsRisk;
  environment: OpsEnvironmentRef | null;
  /** This exact action with these exact inputs was already tried in this job. */
  alreadyTried: boolean;
  /** An approved plan of this job lists exactly this, and the plan has not changed since. */
  inApprovedPlan: boolean;
  /** For an always-ask action: a person confirmed this one step. */
  confirmed: boolean;
  freeUse: boolean;
}

export function decide(facts: GateFacts): Verdict {
  const { environment: env } = facts;
  if (facts.paused) {
    return {
      verdict: "refuse",
      rule: 1,
      reason: "Ops is paused. A person resumes it on the Ops page.",
    };
  }
  if (facts.risk === "own-limits") {
    return {
      verdict: "refuse",
      rule: 2,
      reason:
        "This changes what Ops itself is allowed to do (trust, protection, freeze, the spending cap, channels or triggers). Only a person does that, on the page.",
    };
  }
  if (facts.risk === "always-ask" && !facts.confirmed) {
    return {
      verdict: "ask",
      rule: 3,
      reason:
        "This cannot be undone, so a person confirms this one step in Zelyq, even inside an approved plan.",
    };
  }
  if (env?.frozen && facts.risk !== "read") {
    return {
      verdict: "refuse",
      rule: 4,
      reason: `${env.name} is frozen${env.frozenReason ? `: ${env.frozenReason}` : ""}. Nothing changes there until a person unfreezes it.`,
    };
  }
  if (facts.risk === "read") return { verdict: "run", rule: 5 };
  if (facts.alreadyTried) {
    return {
      verdict: "refuse",
      rule: 6,
      reason:
        "Exactly this was already tried in this job, and nothing has succeeded since that would make it go differently. Find out why it did not work and change something first, or stop and say what you found.",
    };
  }
  if (facts.actor === "agent") {
    return {
      verdict: "ask",
      rule: 7,
      reason: "An outside agent's changes wait for a person.",
    };
  }
  if (env?.trust === "advise") {
    return {
      verdict: "refuse",
      rule: 8,
      reason: `${env.name} is set to "advise only": tell the person exactly what to do instead.`,
    };
  }
  if (facts.inApprovedPlan) return { verdict: "run", rule: 9 };
  if (!env) {
    return facts.freeUse
      ? { verdict: "run", rule: 10 }
      : {
          verdict: "ask",
          rule: 10,
          reason: "This needs to be a step in a plan that a person approves.",
        };
  }
  if (env.trust === "ask" && (env.protected || env.public)) {
    return {
      verdict: "ask",
      rule: 11,
      reason: env.protected
        ? `${env.name} is protected and set to "ask first": put this in a plan for a person to approve.`
        : `${env.name} serves a live site and is set to "ask first": put this in a plan for a person to approve.`,
    };
  }
  return { verdict: "run", rule: 11 };
}
