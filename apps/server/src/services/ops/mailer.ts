import { type Role, roleAtLeast } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { MailService } from "../mail.js";
import type { OpsEvent } from "./service.js";

/**
 * The three messages a launch needs (072 Phase 1), for a person who walked
 * away: "I need your approval", "I need a secret from you", and how it ended.
 * The first two wait a moment and are sent only if it is still waiting, so a
 * person watching the page is not emailed for nothing. A link only opens the
 * Ops page: approving still takes the signed-in person pressing the button.
 */

/** Actions after which "it is live" is news worth an email. */
const SHIPPING = new Set(["run_pipeline", "promote", "rollback", "restart_app", "set_app_address"]);

export class OpsMailer {
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Each waiting plan and each secret is emailed once. */
  private readonly sent = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly mail: MailService,
    private readonly publicUrl: string | undefined,
    private readonly waitMs = 120_000,
  ) {}

  handle(event: OpsEvent): void {
    if (event.kind === "finished") {
      void this.finished(event.jobId).catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const work =
        event.kind === "plan_waiting"
          ? this.planWaiting(event.jobId, event.planHash, event.approver)
          : this.secretWaiting(event.jobId, event.name);
      void work.catch(() => undefined);
    }, this.waitMs);
    timer.unref();
    this.timers.add(timer);
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private link(jobId: string): string {
    return this.publicUrl
      ? `${this.publicUrl.replace(/\/$/, "")}/ops?job=${encodeURIComponent(jobId)}`
      : "Open Zelyq and go to Ops (Ship → Ops).";
  }

  /** The person who asked, if they may approve; otherwise the team's admins too. */
  private async recipients(teamId: string, askedBy: string | null, role: Role): Promise<string[]> {
    const members = await this.store.teams.listMembers(teamId);
    const asker = members.find((member) => member.userId === askedBy);
    if (asker && roleAtLeast(asker.role, role)) return [asker.email];
    return [
      ...(asker ? [asker.email] : []),
      ...members.filter((member) => roleAtLeast(member.role, role)).map((member) => member.email),
    ];
  }

  private async planWaiting(jobId: string, planHash: string, approver: Role): Promise<void> {
    const key = `plan:${jobId}:${planHash}`;
    if (this.sent.has(key)) return;
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job || job.stage !== "approve" || job.planHash !== planHash) return;
    const steps = (await this.store.ops.steps.listForJob(jobId)).filter(
      (step) => step.status === "planned",
    );
    this.sent.add(key);
    await this.mail.send({
      to: await this.recipients(job.teamId, job.askedBy, approver),
      subject: `Ops needs your approval: ${short(job.request)}`,
      text: [
        `You asked: ${job.request}`,
        "",
        "Ops has a plan and waits for your approval before it changes anything:",
        ...steps.map((step) => `  ${step.position + 1}. ${step.words}`),
        "",
        `Read it and approve on the Ops page: ${this.link(jobId)}`,
        "",
        approver === "admin"
          ? "It touches a protected environment, so a team admin approves it."
          : "Any editor of the team can approve it.",
        "Opening the link changes nothing; only pressing Approve there does.",
      ].join("\n"),
    });
  }

  private async secretWaiting(jobId: string, name: string): Promise<void> {
    const key = `secret:${jobId}:${name}`;
    if (this.sent.has(key)) return;
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job || ["done", "failed", "stopped"].includes(job.stage)) return;
    if (await this.store.vault.findByName(job.teamId, name)) return;
    this.sent.add(key);
    await this.mail.send({
      to: await this.recipients(job.teamId, job.askedBy, "editor"),
      subject: `Ops needs a secret from you: ${name}`,
      text: [
        `For "${short(job.request)}", Ops needs ${name} in the team's Vault.`,
        "",
        "Add it yourself in Zelyq: Vault → New secret, named exactly as above.",
        "Ops never sees or types the value, and nobody should send it by email.",
        "",
        `Then tell Ops on its page that it is there: ${this.link(jobId)}`,
      ].join("\n"),
    });
  }

  private async finished(jobId: string): Promise<void> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job || !["done", "failed"].includes(job.stage)) return;
    const steps = await this.store.ops.steps.listForJob(jobId);
    const shipped = steps.some((step) => SHIPPING.has(step.action) && step.status === "done");
    if (job.stage === "done" && !shipped) return;
    if (job.stage === "failed" && steps.length === 0) return;
    const environments = await this.store.deploy.environments.listForTeam(job.teamId);
    const live = await this.store.deploy.deployments.live(environments.map((row) => row.id));
    const where = live
      .filter((deployment) => deployment.url)
      .map((deployment) => {
        const environment = environments.find((row) => row.id === deployment.environmentId);
        return `  ${deployment.app} on ${environment?.name ?? "?"}: ${deployment.url}`;
      });
    await this.mail.send({
      to: await this.recipients(job.teamId, job.askedBy, "editor"),
      subject:
        job.stage === "done"
          ? `Done: ${short(job.request)}`
          : `Ops could not finish: ${short(job.request)}`,
      text: [
        `You asked: ${job.request}`,
        "",
        job.outcome ?? "",
        ...(job.stage === "done" && where.length ? ["", "Live now:", ...where] : []),
        "",
        `The whole record, step by step with what was checked: ${this.link(jobId)}`,
      ].join("\n"),
    });
  }
}

function short(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 70 ? `${line.slice(0, 67)}…` : line;
}
