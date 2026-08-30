/**
 * The named specialists the composer's `/agent` section can point at. These
 * are the same four the agent runs as scoped child turns behind the
 * `*_pass` tools (see `SPECIALISTS` in `apps/agent/src/session.ts`) — this
 * list is static on purpose: the browser only needs a name, a label and a
 * one-liner to render the menu, and the health endpoint has no reason to
 * ship a catalog that never changes between releases.
 *
 * `name` MUST match the agent's `SpecialistKind` key exactly — it is what
 * rides the wire and what `withAgents` keys its hint table by. The drift
 * test in `specialists.test.ts` fails the build if the two lists diverge.
 */
export interface Specialist {
  /** Wire value — matches the agent's `SpecialistKind`. */
  name: string;
  /** Shown in the menu and on the chip. */
  label: string;
  /** One line under the label in the menu. */
  blurb: string;
}

export const SPECIALISTS: Specialist[] = [
  {
    name: "designer",
    label: "Designer",
    blurb: "Look and feel, layout, the design system and reference library.",
  },
  {
    name: "devops",
    label: "DevOps agent",
    blurb: "Environments, CI, containers, deploy and the runbook.",
  },
  {
    name: "security",
    label: "Security/QA agent",
    blurb: "Test plan and coverage, vulnerability review, release sign-off.",
  },
  {
    name: "cinematic",
    label: "Cinematic engineer",
    blurb: "Scroll-driven storytelling — pinned sequences, DOM↔canvas hand-off.",
  },
];
