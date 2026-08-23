import type { FileContent, FileEntry, Preview, Snapshot } from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import type {
  ExecOptions,
  ExecResult,
  ListOptions,
  PreviewOptions,
  ProjectRuntime,
  RuntimeConfig,
  RuntimeDriver,
  RuntimeHealth,
  ScaffoldFile,
} from "./types.js";

/**
 * Talks to a runtime host over HTTP. The host does exactly what
 * `LocalRuntimeDriver` does, but inside an isolated container it controls —
 * which is what makes shared and multi-tenant deployments safe.
 *
 * The contract is small on purpose (see docs/runtime-protocol.md). Anything
 * that can serve these routes is a valid Zelyq runtime: a container per
 * project, a Firecracker VM, a Kubernetes pod, someone's home server.
 */
export class RemoteRuntimeDriver implements RuntimeDriver {
  readonly kind = "remote" as const;

  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly execTimeoutMs: number;

  constructor(config: RuntimeConfig) {
    if (!config.url) {
      throw new Error("ZELYQ_RUNTIME=remote requires ZELYQ_RUNTIME_URL");
    }
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.token = config.token;
    this.execTimeoutMs = config.execTimeoutMs;
  }

  async health(): Promise<RuntimeHealth> {
    try {
      const body = await this.request<{ version?: string }>("GET", "/v1/health");
      return { kind: this.kind, ok: true, detail: this.baseUrl, version: body.version };
    } catch (error) {
      return { kind: this.kind, ok: false, detail: (error as Error).message };
    }
  }

  async ensureProject(projectId: string): Promise<ProjectRuntime> {
    return await this.request<ProjectRuntime>("POST", `/v1/projects/${projectId}`);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.request("DELETE", `/v1/projects/${projectId}`);
  }

  async scaffold(projectId: string, files: ScaffoldFile[]): Promise<void> {
    await this.request("POST", `/v1/projects/${projectId}/scaffold`, { files });
  }

  async exec(projectId: string, options: ExecOptions): Promise<ExecResult> {
    return await this.request<ExecResult>(
      "POST",
      `/v1/projects/${projectId}/exec`,
      { ...options, timeoutMs: options.timeoutMs ?? this.execTimeoutMs },
      // Give the host a little longer than the command itself, so a host-side
      // timeout produces a structured result instead of a socket error.
      (options.timeoutMs ?? this.execTimeoutMs) + 15_000,
    );
  }

  async listFiles(projectId: string, options: ListOptions = {}): Promise<FileEntry[]> {
    const query = new URLSearchParams();
    if (options.path) query.set("path", options.path);
    if (options.depth) query.set("depth", String(options.depth));
    if (options.includeIgnored) query.set("includeIgnored", "1");
    const suffix = query.size > 0 ? `?${query}` : "";
    const body = await this.request<{ entries: FileEntry[] }>(
      "GET",
      `/v1/projects/${projectId}/files${suffix}`,
    );
    return body.entries;
  }

  async readFile(projectId: string, path: string): Promise<FileContent> {
    return await this.request<FileContent>(
      "GET",
      `/v1/projects/${projectId}/files/${encodeURI(path)}`,
    );
  }

  async writeFile(
    projectId: string,
    path: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8",
  ): Promise<void> {
    await this.request("PUT", `/v1/projects/${projectId}/files/${encodeURI(path)}`, {
      content,
      encoding,
    });
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    await this.request("DELETE", `/v1/projects/${projectId}/files/${encodeURI(path)}`);
  }

  async startPreview(projectId: string, options: PreviewOptions = {}): Promise<Preview> {
    return await this.request<Preview>(
      "POST",
      `/v1/projects/${projectId}/preview/start`,
      options,
      120_000,
    );
  }

  async stopPreview(projectId: string): Promise<Preview> {
    return await this.request<Preview>("POST", `/v1/projects/${projectId}/preview/stop`);
  }

  async previewStatus(projectId: string): Promise<Preview> {
    return await this.request<Preview>("GET", `/v1/projects/${projectId}/preview`);
  }

  async previewLogs(projectId: string, lines = 200): Promise<string> {
    const body = await this.request<{ logs: string }>(
      "GET",
      `/v1/projects/${projectId}/preview/logs?lines=${lines}`,
    );
    return body.logs;
  }

  async createSnapshot(projectId: string, label: string): Promise<Snapshot> {
    return await this.request<Snapshot>("POST", `/v1/projects/${projectId}/snapshots`, { label });
  }

  async restoreSnapshot(projectId: string, snapshotId: string): Promise<void> {
    await this.request("POST", `/v1/projects/${projectId}/snapshots/${snapshotId}/restore`);
  }

  async readSnapshotFile(
    projectId: string,
    snapshotId: string,
    filePath: string,
  ): Promise<FileContent> {
    return await this.request<FileContent>(
      "GET",
      `/v1/projects/${projectId}/snapshots/${snapshotId}/files/${encodeURI(filePath)}`,
    );
  }

  async dispose(): Promise<void> {
    // Nothing is held open locally; the host owns every resource.
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status === 404) throw ZelyqError.notFound("Runtime resource", path);
        throw new ZelyqError(
          "runtime_unavailable",
          `Runtime host returned ${response.status} for ${method} ${path}`,
          { body: text.slice(0, 1000) },
        );
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ZelyqError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new ZelyqError("runtime_unavailable", `Runtime host timed out on ${method} ${path}`);
      }
      throw new ZelyqError(
        "runtime_unavailable",
        `Cannot reach runtime host: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
