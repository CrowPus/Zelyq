import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";
import { CODEX_MODEL_CANDIDATES, type SettingsService } from "../services/settings.js";

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
        // In the composer's own model picker, not just Settings'
        // suggestions: a Codex session's real model names
        // are a different, unconfirmed set from the ordinary API's single
        // "gpt-5.2" — fixing the suggestions in Settings and missing this,
        // the picker a person actually uses daily, left it looking like
        // nothing had changed at all.
        ...(provider.id === "openai" &&
        (await deps.settings.authModeFor("openai")) === "subscription"
          ? { models: CODEX_MODEL_CANDIDATES.map((value) => ({ value, label: value })) }
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
