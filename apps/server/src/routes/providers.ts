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
    const user = deps.access.requireUser(request);
    // For a team: whether it has a key, its own or the server's it may use.
    const teamId = (request.query as { teamId?: string } | undefined)?.teamId ?? null;
    if (teamId) await deps.access.requireTeamRole(user, teamId, "viewer");
    // For a team: its own provider choice, keys and model lists.
    return deps.settings.forTeam(teamId, async () => {
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
          configured: Boolean(await deps.settings.apiKeyFor(provider.id, teamId)),
          ...(provider.id === "openai"
            ? await deps.settings.openAIModels()
            : provider.id === "anthropic"
              ? await deps.settings.anthropicModels()
              : provider.id === "google"
                ? await deps.settings.googleModels()
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
      // And the model, resolved exactly as a turn resolves it (gateway.ts),
      // so the builder names what "Default" really sends for this team
      // rather than whatever the agent process started with.
      const requested = await deps.settings.modelFor(liveDefault);
      const defaultModel =
        (liveDefault === "openai"
          ? await deps.settings.resolveOpenAIModel(requested)
          : liveDefault === "anthropic"
            ? await deps.settings.resolveAnthropicModel(requested)
            : liveDefault === "google"
              ? await deps.settings.resolveGoogleModel(requested)
              : requested) ||
        listed.providers.find((provider) => provider.id === liveDefault)?.defaultModel ||
        undefined;
      return {
        ...listed,
        default: liveDefault,
        ...(defaultModel ? { defaultModel } : {}),
        providers,
      };
    });
  });
}
