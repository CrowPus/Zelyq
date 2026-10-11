import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  cronMatches,
  newId,
  type PipelineTriggerSummary,
  parseCron,
  parsePipelineFile,
  type TriggerInput,
  triggerInputSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { PipelineRunRow, PipelineTriggerRow, Store } from "@zelyq/db";
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
    return Promise.all(
      (await this.store.pipelines.triggers.list(pipelineId)).map((row) => this.present(row)),
    );
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
    await this.checkUpstream(teamId, pipelineId, input);
    const row: PipelineTriggerRow = {
      id: newId("pipelineTrigger"),
      pipelineId,
      kind: input.kind,
      config: configOf(input),
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
    return { trigger: await this.present(row), secret };
  }

  /**
   * Changes what a trigger listens for. The kind stays, and so do a push
   * trigger's address and secret: the webhook in GitHub or GitLab keeps working.
   */
  async edit(
    user: User,
    teamId: string,
    pipelineId: string,
    triggerId: string,
    raw: TriggerInput,
  ): Promise<PipelineTriggerSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const pipeline = await this.pipeline(teamId, pipelineId);
    const row = await this.find(teamId, pipelineId, triggerId);
    const input = triggerInputSchema.parse(raw);
    if (input.kind !== row.kind) {
      throw ZelyqError.badRequest("A trigger keeps its kind; add a new one instead.");
    }
    await this.checkUpstream(teamId, pipelineId, input);
    const config = configOf(input);
    await this.store.pipelines.triggers.update(row.id, { config });
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.trigger_changed",
      detail: { label: pipeline.name, kind: input.kind },
    });
    return await this.present({ ...row, config });
  }

  private async checkUpstream(
    teamId: string,
    pipelineId: string,
    input: ReturnType<typeof triggerInputSchema.parse>,
  ): Promise<void> {
    if (input.kind !== "pipeline") return;
    const upstream = await this.store.pipelines.pipelines.findById(input.pipelineId);
    if (!upstream || upstream.teamId !== teamId) {
      throw ZelyqError.badRequest("Choose another pipeline of this team.");
    }
    if (upstream.id === pipelineId) {
      throw ZelyqError.badRequest("A pipeline cannot start after itself.");
    }
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
    return await this.present({ ...row, enabled });
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
    let payload: WebhookPayload;
    try {
      const text = body.toString("utf8");
      // GitHub's other content type: the same JSON, form-encoded as payload=.
      payload = JSON.parse(
        text.startsWith("payload=") ? (new URLSearchParams(text).get("payload") ?? "") : text,
      );
    } catch {
      return { status: 400, message: "The body is not JSON." };
    }
    const config = JSON.parse(row.config) as {
      branches?: string[];
      paths?: string[];
      pullRequests?: boolean;
    };
    const branches = config.branches ?? [];

    // A pull request (GitHub) or merge request (GitLab): its latest commit.
    const request = pullRequestOf(event, payload);
    if (request) {
      if (!config.pullRequests)
        return { status: 202, message: "This trigger does not run for pull requests." };
      if (request.ignored) return { status: 202, message: request.ignored };
      if (request.fork) {
        return {
          status: 202,
          message:
            "Pull requests from forks do not run: their code would run with this team's secrets.",
        };
      }
      if (!branches.some((pattern) => branchMatches(pattern, request.base))) {
        return {
          status: 202,
          message: `Pull requests into ${request.base} do not run this pipeline.`,
        };
      }
      const run = await this.pipelines.startTriggered(
        row.pipelineId,
        "pull_request",
        request.commit,
        request.branch,
        {
          commitMessage: request.message,
          pullRequest: {
            number: request.number,
            title: request.title.slice(0, 300),
            url: request.url && /^https:\/\//.test(request.url) ? request.url : null,
            base: request.base,
          },
        },
      );
      await this.store.pipelines.triggers.update(row.id, { lastFiredAt: new Date().toISOString() });
      return { status: 201, message: `Started run #${run.number}.` };
    }

    const branch = payload.ref?.startsWith("refs/heads/")
      ? payload.ref.slice("refs/heads/".length)
      : null;
    if (!branch) return { status: 202, message: "Not a branch push; nothing to run." };
    const commit = payload.checkout_sha ?? payload.after ?? null;
    if (payload.deleted || !commit || /^0+$/.test(commit)) {
      return { status: 202, message: "A deleted branch; nothing to run." };
    }
    if (!branches.some((pattern) => branchMatches(pattern, branch))) {
      return { status: 202, message: `${branch} is not one of this trigger's branches.` };
    }
    // Paths: only when the push changed a matching file. A push too big for
    // the webhook to list every file runs anyway: one run too many is better
    // than a change that never ships.
    const paths = config.paths ?? [];
    if (paths.length > 0) {
      const changed = changedFiles(payload);
      if (
        changed !== null &&
        !changed.some((file) => paths.some((pattern) => pathMatches(pattern, file)))
      ) {
        return { status: 202, message: "The push changed none of this trigger's paths." };
      }
    }
    const run = await this.pipelines.startTriggered(
      row.pipelineId,
      "push",
      /^[0-9a-f]{7,64}$/i.test(commit) ? commit : branch,
      branch,
      {
        // GitHub names the head commit; GitLab lists the commits, newest last.
        commitMessage:
          payload.head_commit?.message ??
          payload.commits?.find((pushed) => pushed.id === commit)?.message ??
          null,
      },
    );
    await this.store.pipelines.triggers.update(row.id, { lastFiredAt: new Date().toISOString() });
    return { status: 201, message: `Started run #${run.number}.` };
  }

  /**
   * The agent changed an app's files: every pipeline whose source is that app
   * and that has a "when the app changes" trigger starts a run.
   */
  async appChanged(project: { id: string; name: string; teamId: string }): Promise<number> {
    let started = 0;
    for (const row of await this.store.pipelines.triggers.listEnabled("app").catch(() => [])) {
      try {
        const pipeline = await this.store.pipelines.pipelines.findById(row.pipelineId);
        if (!pipeline || pipeline.teamId !== project.teamId) continue;
        const parsed = parsePipelineFile(pipeline.source);
        const app = parsed.ok ? parsed.file.source?.app : undefined;
        if (!app || (app !== project.id && app.toLowerCase() !== project.name.toLowerCase()))
          continue;
        await this.store.pipelines.triggers.update(row.id, {
          lastFiredAt: new Date().toISOString(),
        });
        await this.pipelines.startTriggered(row.pipelineId, "app", null);
        started += 1;
      } catch (error) {
        this.log.error(error, `app trigger ${row.id} failed`);
      }
    }
    return started;
  }

  /**
   * A run ended: pipelines that start "after" its pipeline (on that ending)
   * start now, with the same commit and branch, linked to it as upstream.
   */
  async runFinished(run: PipelineRunRow): Promise<number> {
    let started = 0;
    for (const row of await this.store.pipelines.triggers.listEnabled("pipeline").catch(() => [])) {
      try {
        const config = JSON.parse(row.config) as { pipelineId?: string; on?: string[] };
        if (config.pipelineId !== run.pipelineId) continue;
        if (!(config.on ?? ["passed"]).includes(run.status)) continue;
        const downstream = await this.store.pipelines.pipelines.findById(row.pipelineId);
        if (!downstream || downstream.teamId !== run.teamId) continue;
        await this.store.pipelines.triggers.update(row.id, {
          lastFiredAt: new Date().toISOString(),
        });
        await this.pipelines.startTriggered(row.pipelineId, "pipeline", run.ref, run.branch, {
          upstream: run,
        });
        started += 1;
      } catch (error) {
        this.log.error(error, `pipeline trigger ${row.id} failed`);
      }
    }
    return started;
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

  private async present(row: PipelineTriggerRow): Promise<PipelineTriggerSummary> {
    const config = JSON.parse(row.config) as {
      branches?: string[];
      paths?: string[];
      pullRequests?: boolean;
      cron?: string;
      pipelineId?: string;
      on?: ("passed" | "failed")[];
    };
    const base = (this.publicUrl ?? "").replace(/\/$/, "");
    const upstream = config.pipelineId
      ? await this.store.pipelines.pipelines.findById(config.pipelineId)
      : null;
    return {
      id: row.id,
      kind:
        row.kind === "schedule" || row.kind === "app" || row.kind === "pipeline"
          ? row.kind
          : "push",
      upstream: config.pipelineId
        ? {
            id: config.pipelineId,
            name: upstream?.name ?? "(removed)",
            on: config.on ?? ["passed"],
          }
        : null,
      branches: config.branches ?? null,
      paths: config.paths ?? [],
      pullRequests: config.pullRequests ?? false,
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

function configOf(input: ReturnType<typeof triggerInputSchema.parse>): string {
  return JSON.stringify(
    input.kind === "push"
      ? { branches: input.branches, paths: input.paths, pullRequests: input.pullRequests }
      : input.kind === "schedule"
        ? { cron: input.cron }
        : input.kind === "pipeline"
          ? { pipelineId: input.pipelineId, on: input.on }
          : {},
  );
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

interface WebhookPayload {
  ref?: string;
  after?: string;
  checkout_sha?: string;
  deleted?: boolean;
  total_commits_count?: number;
  commits?: {
    id?: string;
    message?: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }[];
  head_commit?: { message?: string } | null;
  // GitHub pull_request
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    head?: { sha?: string; ref?: string; repo?: { full_name?: string } | null };
    base?: { ref?: string; repo?: { full_name?: string } };
  };
  // GitLab merge request
  object_kind?: string;
  object_attributes?: {
    action?: string;
    source_branch?: string;
    target_branch?: string;
    source_project_id?: number;
    target_project_id?: number;
    iid?: number;
    title?: string;
    url?: string;
    last_commit?: { id?: string; message?: string };
  };
}

/** The pull/merge request a webhook is about, or null when it is not one. */
function pullRequestOf(
  event: string | undefined,
  payload: WebhookPayload,
): {
  commit: string;
  branch: string;
  base: string;
  fork: boolean;
  ignored?: string;
  number: number;
  title: string;
  url: string | null;
  message: string | null;
} | null {
  if (event === "pull_request" && payload.pull_request) {
    const pr = payload.pull_request;
    const ignored = ["opened", "synchronize", "reopened"].includes(payload.action ?? "")
      ? undefined
      : `A pull request was ${payload.action}; nothing to run.`;
    return {
      commit: pr.head?.sha ?? "",
      branch: pr.head?.ref ?? "",
      base: pr.base?.ref ?? "",
      // No head repository (deleted fork), or another one: a fork.
      fork: !pr.head?.repo || pr.head.repo.full_name !== pr.base?.repo?.full_name,
      ignored,
      number: pr.number ?? 0,
      title: pr.title ?? "",
      url: pr.html_url ?? null,
      message: null,
    };
  }
  if (payload.object_kind === "merge_request" && payload.object_attributes) {
    const mr = payload.object_attributes;
    const ignored = ["open", "update", "reopen"].includes(mr.action ?? "")
      ? undefined
      : `A merge request was ${mr.action ?? "changed"}; nothing to run.`;
    return {
      commit: mr.last_commit?.id ?? "",
      branch: mr.source_branch ?? "",
      base: mr.target_branch ?? "",
      fork: mr.source_project_id !== mr.target_project_id,
      ignored,
      number: mr.iid ?? 0,
      title: mr.title ?? "",
      url: mr.url ?? null,
      message: mr.last_commit?.message ?? null,
    };
  }
  return null;
}

/** Every file a push changed, or null when the webhook did not list them all. */
function changedFiles(payload: WebhookPayload): string[] | null {
  const commits = payload.commits;
  if (!Array.isArray(commits) || commits.length === 0) return null;
  // GitHub and GitLab list at most 20 commits in a webhook.
  if (commits.length >= 20 || (payload.total_commits_count ?? 0) > commits.length) return null;
  const files = new Set<string>();
  for (const commit of commits) {
    if (!commit.added && !commit.modified && !commit.removed) return null;
    for (const file of [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]) {
      files.add(file);
    }
  }
  return [...files];
}

/** "frontend/**", "*.md" — `*` within a folder, `**` across folders. */
export function pathMatches(pattern: string, file: string): boolean {
  return branchMatches(pattern.replace(/^\.?\//, ""), file);
}
