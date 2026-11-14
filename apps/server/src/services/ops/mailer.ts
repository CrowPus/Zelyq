import { type Role, roleAtLeast } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { MailService } from "../mail.js";
import type { ChannelService, Notice } from "./channels.js";
import type { OpsEvent } from "./service.js";
import type { WatchEvent } from "./watch/checks.js";

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
  /** Chats beyond email (Telegram, Slack, Discord), each person as they chose. */
  channels: ChannelService | null = null;
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

  /** The watch's alerts: opened, moved on to the next person, or over. */
  handleWatch(event: WatchEvent): void {
    void this.watchMail(event).catch(() => undefined);
  }

  private async watchMail(event: WatchEvent): Promise<void> {
    const { alert } = event;
    const audience = alert.severity === "urgent" ? "urgent" : "warning";
    const status = this.publicUrl
      ? `${this.publicUrl.replace(/\/$/, "")}/ops#status`
      : "Open Zelyq and go to Ops → Status.";
    const subject =
      event.kind === "alert_closed"
        ? `Back: ${alert.title}`
        : event.kind === "alert_escalated"
          ? `Nobody has answered yet: ${alert.title}`
          : `${alert.severity === "urgent" ? "Down" : "Warning"}: ${alert.title}`;
    const lines =
      event.kind === "alert_closed"
        ? [
            `${alert.title} — over (${alert.closedHow ?? "closed"}).`,
            `It began ${alert.openedAt.replace("T", " ").slice(0, 16)} UTC and ended ${String(alert.closedAt).replace("T", " ").slice(0, 16)} UTC.`,
          ]
        : [
            alert.title,
            "",
            `What the check saw: ${alert.detail ?? "no detail"}`,
            `Since: ${alert.openedAt.replace("T", " ").slice(0, 16)} UTC`,
            ...(event.kind === "alert_escalated"
              ? ["", "Nobody has acknowledged it yet, so it has come to you."]
              : []),
            "",
            'Press "I\'m on it" on the Status page so the team knows; silence it there for planned work.',
          ];
    await this.tell(event.teamId, event.to, {
      audience,
      title: subject,
      lines: event.kind === "alert_closed" ? lines : lines.slice(1, -2),
      link: this.publicUrl ? status : null,
      teamWide: event.kind !== "alert_escalated",
    });
    const to = await this.emailsOf(event.teamId, event.to, audience);
    if (to.length > 0)
      await this.mail.send({ to, subject, text: [...lines, "", `Status: ${status}`].join("\n") });
  }

  /** The same news in each person's chats; never holds up the email. */
  private async tell(teamId: string, userIds: string[], notice: Notice): Promise<void> {
    await this.channels?.notify(teamId, userIds, notice).catch(() => undefined);
  }

  /** The addresses of the people who want this kind of news by email. */
  private async emailsOf(
    teamId: string,
    userIds: string[],
    audience: Notice["audience"],
  ): Promise<string[]> {
    const emails: string[] = [];
    for (const userId of new Set(userIds)) {
      if (this.channels && !(await this.channels.wantsEmail(teamId, userId, audience))) continue;
      const user = await this.store.users.findById(userId);
      if (user?.email) emails.push(user.email);
    }
    return emails;
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
    if (asker && roleAtLeast(asker.role, role)) return [asker.userId];
    return [
      ...new Set([
        ...(asker ? [asker.userId] : []),
        ...members
          .filter((member) => roleAtLeast(member.role, role))
          .map((member) => member.userId),
      ]),
    ];
  }

  /** One message, by email and in chats, to these people. */
  private async send(
    teamId: string,
    userIds: string[],
    subject: string,
    lines: string[],
    link: string,
  ): Promise<void> {
    // Ops's own messages go to the people concerned only, never to a shared channel.
    await this.tell(teamId, userIds, {
      audience: "approval",
      title: subject,
      lines: this.publicUrl ? lines.filter((line) => !line.includes(link)) : lines,
      link: this.publicUrl ? link : null,
      teamWide: false,
    });
    const to = await this.emailsOf(teamId, userIds, "approval");
    if (to.length > 0) await this.mail.send({ to, subject, text: lines.join("\n") });
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
    await this.send(
      job.teamId,
      await this.recipients(job.teamId, job.askedBy, approver),
      `Ops needs your approval: ${short(job.request)}`,
      [
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
      ],
      this.link(jobId),
    );
  }

  private async secretWaiting(jobId: string, name: string): Promise<void> {
    const key = `secret:${jobId}:${name}`;
    if (this.sent.has(key)) return;
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job || ["done", "failed", "stopped"].includes(job.stage)) return;
    if (await this.store.vault.findByName(job.teamId, name)) return;
    this.sent.add(key);
    await this.send(
      job.teamId,
      await this.recipients(job.teamId, job.askedBy, "editor"),
      `Ops needs a secret from you: ${name}`,
      [
        `For "${short(job.request)}", Ops needs ${name} in the team's Vault.`,
        "",
        "Add it yourself in Zelyq: Vault → New secret, named exactly as above.",
        "Ops never sees or types the value; nobody should send it by email or chat.",
        "",
        `Then tell Ops on its page that it is there: ${this.link(jobId)}`,
      ],
      this.link(jobId),
    );
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
    await this.send(
      job.teamId,
      await this.recipients(job.teamId, job.askedBy, "editor"),
      job.stage === "done"
        ? `Done: ${short(job.request)}`
        : `Ops could not finish: ${short(job.request)}`,
      [
        `You asked: ${job.request}`,
        "",
        job.outcome ?? "",
        ...(job.stage === "done" && where.length ? ["", "Live now:", ...where] : []),
        "",
        `The whole record, step by step with what was checked: ${this.link(jobId)}`,
      ],
      this.link(jobId),
    );
  }
}

function short(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 70 ? `${line.slice(0, 67)}…` : line;
}
