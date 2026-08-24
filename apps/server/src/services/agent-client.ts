import {
  type AgentEvent,
  type AgentSessionState,
  type AvailableProviders,
  agentEventSchema,
  availableProvidersSchema,
  type Message,
  ZelyqError,
} from "@zelyq/core";

/**
 * Thin client for the agent service. It exists so the rest of the server never
 * has to think about SSE framing — callers get an async iterable of typed
 * events and can `for await` over a turn.
 */
export class AgentClient {
  constructor(private readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async health(): Promise<{ status: string } & Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new ZelyqError("runtime_unavailable", "Agent service is unhealthy");
    return (await response.json()) as { status: string };
  }

  /** What the chat's model picker offers — see `033`. */
  async listProviders(): Promise<AvailableProviders> {
    const response = await fetch(`${this.baseUrl}/providers`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new ZelyqError("runtime_unavailable", "Agent service is unhealthy");
    }
    return availableProvidersSchema.parse(await response.json());
  }

  async createSession(input: {
    sessionId: string;
    projectId: string;
    provider?: string;
    model?: string;
    effort?: string;
    apiKey?: string;
    baseUrl?: string;
    history?: Message[];
  }): Promise<AgentSessionState> {
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ZelyqError(
        response.status === 401 ? "unauthorized" : "runtime_unavailable",
        body?.error?.message ?? `Agent service returned ${response.status}`,
      );
    }

    return (await response.json()) as AgentSessionState;
  }

  /**
   * Makes sure the agent holds this session, creating it only if it does not
   * — or if what it already holds no longer matches what is actually being
   * asked for.
   *
   * Recreating it on every prompt would throw away the agent's in-memory
   * conversation and force the whole history back over the wire each turn,
   * which also discards the prompt cache the session was building. But a
   * cached session's provider or model is only trustworthy while it matches
   * what is currently configured — settings can change without a restart,
   * and reusing a stale session unconditionally is exactly how a changed
   * provider silently never took effect (found live, not assumed: every
   * real session on a real instance stayed pinned to whatever provider it
   * was first created with, forever).
   *
   * A session mid-turn is left alone regardless — evicting it to switch
   * providers underneath an in-flight turn would abort it, a worse failure
   * than finishing on the provider it started with and picking up the
   * change on the next prompt. Recreating reuses the same history-from-
   * persisted-messages path a restart already goes through — see `029` —
   * so nothing new has to be built to reconstruct it.
   */
  async ensureSession(input: {
    sessionId: string;
    projectId: string;
    provider?: string;
    model?: string;
    effort?: string;
    apiKey?: string;
    baseUrl?: string;
    history?: Message[];
  }): Promise<AgentSessionState> {
    const existing = await fetch(`${this.baseUrl}/sessions/${input.sessionId}/state`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (existing?.ok) {
      const state = (await existing.json()) as AgentSessionState;
      const changed =
        (input.provider !== undefined && input.provider !== state.provider) ||
        (input.model !== undefined && input.model !== state.model);
      if (!changed || state.busy) return state;
      await this.destroySession(input.sessionId);
    }

    return await this.createSession(input);
  }

  async destroySession(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }

  async abort(sessionId: string): Promise<void> {
    await fetch(`${this.baseUrl}/sessions/${sessionId}/abort`, { method: "POST" }).catch(
      () => undefined,
    );
  }

  /** Streams one turn. The iterator ends when the agent closes the SSE stream. */
  async *prompt(
    sessionId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Agent service returned ${response.status} starting the turn`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. A partial frame stays in
        // the buffer until the rest of it arrives.
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf("\n\n");

          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          const parsed = agentEventSchema.safeParse(JSON.parse(dataLine.slice(6)));
          if (parsed.success) yield parsed.data;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
