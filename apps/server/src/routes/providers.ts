import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";
import type { SettingsService } from "../services/settings.js";

/**
 * What the chat's model picker needs. Unlike `/api/settings`,
 * open to anyone signed in: which providers have a usable key is not
 * sensitive on its own, and gating it to instance admins would mean only an
 * admin could ever see the picker's options.
 */
export function registerProviderRoutes(
  app: FastifyInstance,
  deps: { agent: AgentClient; access: AccessControl; settings: SettingsService },
): void {
  app.get("/api/providers", async (request) => {
    deps.access.requireUser(request);
    const listed = await deps.agent.listProviders();
    // The agent's own `configured` only ever checked its own process
    // environment — true before Settings could hold a key at all, wrong
    // the moment one is stored there instead (a pasted key, or a detected
    // Claude Code session). Connecting a subscription session would
    // otherwise never make the provider it belongs to show up here, because
    // this never asked the one place that actually knows.
    // `apiKeyFor` already resolves the same env → database precedence a
    // real turn uses, so this is the exact same answer, not an
    // approximation of it.
    const providers = await Promise.all(
      listed.providers.map(async (provider) => ({
        ...provider,
        configured: Boolean(await deps.settings.apiKeyFor(provider.id)),
        ...(provider.id === "openai"
          ? await deps.settings.openAIModels()
          : provider.id === "anthropic"
            ? await deps.settings.anthropicModels()
            : {}),
      })),
    );
    // Same story as `configured` above: the agent's own `default` is
    // whatever it booted with, never updated again for the life of the
    // process. A turn itself already resolves the live setting correctly
    // (see gateway.ts) — this just makes the picker's own label agree with
    // what "Default" will actually send, instead of naming whichever
    // provider the agent happened to start with. `value("provider")` is
    // always one of the registered ids — writing it goes through the same
    // options check every other select setting does.
    const liveDefault = (await deps.settings.value("provider")) as typeof listed.default;
    return { ...listed, default: liveDefault, providers };
  });
}
