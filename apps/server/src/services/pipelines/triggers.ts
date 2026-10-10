import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  cronMatches,
  newId,
  type PipelineTriggerSummary,
  parseCron,
  type TriggerInput,
  triggerInputSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { PipelineTriggerRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import type { SecretBox } from "../secrets.js";
import type { PipelineService } from "./service.js";

/**
 * What starts a run besides a person pressing Run:
 *
 * - **push**: GitHub or GitLab calls a webhook when someone pushes. The call
 *   is accepted only with the trigger's secret — GitHub signs the body with
 *   it, GitLab sends it as a token — and only for the branches listed.
 * - **schedule**: five-field cron, in UTC, checked every half minute. The last
 *   firing is stored, so a restart never fires the same minute twice.
 */
export class PipelineTriggerService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly box: SecretBox,
    private readonly pipelines: PipelineService,
    private readonly publicUrl: string | undefined,
    private readonly log: { error(object: unknown, message: string): void },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 30_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(user: User, teamId: string, pipelineId: string): Promise<PipelineTriggerSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    await this.pipeline(teamId, pipelineId);
    return (await this.store.pipelines.triggers.list(pipelineId)).map((row) => this.present(row));
  }

  /** Adds a trigger. A push trigger's secret is in the answer once, and never again. */
  async add(
    user: User,
    teamId: string,
    pipelineId: string,
    raw: TriggerInput,
  ): Promise<{ trigger: PipelineTriggerSummary; secret: string | null }> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const pipeline = await this.pipeline(teamId, pipelineId);
    const input = triggerInputSchema.parse(raw);
    const secret = input.kind === "push" ? randomBytes(24).toString("hex") : null;
    const row: PipelineTriggerRow = {
      id: newId("pipelineTrigger"),
      pipelineId,
      kind: input.kind,
      config: JSON.stringify(
        input.kind === "push" ? { branches: input.branches } : { cron: input.cron },
      ),
      secret: secret ? this.box.encrypt(secret) : null,
      enabled: true,
      lastFiredAt: null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await this.store.pipelines.triggers.create(row);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.trigger_added",
      detail: { label: pipeline.name, kind: input.kind },
    });
    return { trigger: this.present(row), secret };
  }

  async setEnabled(
    user: User,
    teamId: string,
    pipelineId: string,
    triggerId: string,
    enabled: boolean,
  ): Promise<PipelineTriggerSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId, triggerId);
    await this.store.pipelines.triggers.update(row.id, { enabled });
    return this.present({ ...row, enabled });
  }

  async remove(user: User, teamId: string, pipelineId: string, triggerId: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const pipeline = await this.pipeline(teamId, pipelineId);
    const row = await this.find(teamId, pipelineId, triggerId);
    await this.store.pipelines.triggers.remove(row.id);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.trigger_removed",
      detail: { label: pipeline.name, kind: row.kind },
    });
  }

  /**
   * A webhook call. The answer is deliberately the same for a trigger that
   * does not exist and one whose secret is wrong.
   */
  async webhook(
    triggerId: string,
    headers: Record<string, string | string[] | undefined>,
    body: Buffer,
  ): Promise<{ status: number; message: string }> {
    const row = await this.store.pipelines.triggers.findById(triggerId);
    const secret = row?.kind === "push" && row.secret ? this.box.decrypt(row.secret) : null;
    if (!row || !secret || !verified(secret, headers, body)) {
      return { status: 401, message: "Unknown trigger or wrong secret." };
    }
    const event = header(headers, "x-github-event") ?? header(headers, "x-gitlab-event");
    if (event === "ping") return { status: 200, message: "pong" };
    if (!row.enabled) return { status: 202, message: "This trigger is turned off." };
    let payload: { ref?: string; after?: string; checkout_sha?: string; deleted?: boolean };
    try {
      const text = body.toString("utf8");
      // GitHub's other content type: the same JSON, form-encoded as payload=.
      payload = JSON.parse(
        text.startsWith("payload=") ? (new URLSearchParams(text).get("payload") ?? "") : text,
      );
    } catch {
      return { status: 400, message: "The body is not JSON." };
    }
    const branch = payload.ref?.startsWith("refs/heads/")
      ? payload.ref.slice("refs/heads/".length)
      : null;
    if (!branch) return { status: 202, message: "Not a branch push; nothing to run." };
    const commit = payload.checkout_sha ?? payload.after ?? null;
    if (payload.deleted || !commit || /^0+$/.test(commit)) {
      return { status: 202, message: "A deleted branch; nothing to run." };
    }
    const branches: string[] = JSON.parse(row.config).branches ?? [];
    if (!branches.some((pattern) => branchMatches(pattern, branch))) {
      return { status: 202, message: `${branch} is not one of this trigger's branches.` };
    }
    const run = await this.pipelines.startTriggered(
      row.pipelineId,
      "push",
      /^[0-9a-f]{7,64}$/i.test(commit) ? commit : branch,
      branch,
    );
    await this.store.pipelines.triggers.update(row.id, { lastFiredAt: new Date().toISOString() });
    return { status: 201, message: `Started run #${run.number}.` };
  }

  /** Fires every schedule whose minute it is, once. */
  async tick(now = new Date()): Promise<void> {
    const minute = new Date(now);
    minute.setUTCSeconds(0, 0);
    const triggers = await this.store.pipelines.triggers.listEnabled("schedule").catch(() => []);
    for (const row of triggers) {
      try {
        const schedule = parseCron(JSON.parse(row.config).cron ?? "");
        if (!schedule || !cronMatches(schedule, minute)) continue;
        if (row.lastFiredAt && Date.parse(row.lastFiredAt) >= minute.getTime()) continue;
        await this.store.pipelines.triggers.update(row.id, { lastFiredAt: now.toISOString() });
        await this.pipelines.startTriggered(row.pipelineId, "schedule", null);
      } catch (error) {
        this.log.error(error, `schedule trigger ${row.id} failed`);
      }
    }
  }

  private async pipeline(teamId: string, pipelineId: string) {
    const row = await this.store.pipelines.pipelines.findById(pipelineId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Pipeline", pipelineId);
    return row;
  }

  private async find(
    teamId: string,
    pipelineId: string,
    triggerId: string,
  ): Promise<PipelineTriggerRow> {
    await this.pipeline(teamId, pipelineId);
    const row = await this.store.pipelines.triggers.findById(triggerId);
    if (!row || row.pipelineId !== pipelineId) throw ZelyqError.notFound("Trigger", triggerId);
    return row;
  }

  private present(row: PipelineTriggerRow): PipelineTriggerSummary {
    const config = JSON.parse(row.config) as { branches?: string[]; cron?: string };
    const base = (this.publicUrl ?? "").replace(/\/$/, "");
    return {
      id: row.id,
      kind: row.kind === "schedule" ? "schedule" : "push",
      branches: config.branches ?? null,
      cron: config.cron ?? null,
      enabled: row.enabled,
      lastFiredAt: row.lastFiredAt,
      webhookUrl: row.kind === "push" ? `${base}/api/hooks/pipelines/${row.id}` : null,
      createdAt: row.createdAt,
    };
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** GitHub (and anything that signs the same way) or GitLab's token. */
function verified(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): boolean {
  const signature = header(headers, "x-hub-signature-256");
  if (signature) {
    return same(signature, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  }
  const token = header(headers, "x-gitlab-token");
  return token !== undefined && same(token, secret);
}

/** "main", "release/*" — `*` matches anything but "/", `**` anything at all. */
export function branchMatches(pattern: string, branch: string): boolean {
  const regex = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${regex}$`).test(branch);
}
