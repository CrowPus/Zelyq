import { type User, ZelyqError } from "@zelyq/core";
import type { AccessControl } from "./access.js";
import { type SettingsService, TEAM_KEY_NAME } from "./settings.js";
import type { VaultService } from "./vault.js";

/**
 * A team's own AI keys (Claude, Gemini, OpenAI, …). On a shared server each
 * team brings its own: they are kept in the team's Vault under the provider's
 * usual name (ANTHROPIC_API_KEY, GEMINI_API_KEY, …), encrypted, never shown
 * again, and used before the server's for everything the team does: its
 * apps' chat, Ops, voice, and Studio's images and video. A team admin sets
 * them on the Team page.
 */

export const TEAM_KEY_PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: "anthropic", label: "Claude", hint: "console.anthropic.com → API keys (sk-ant-…)" },
  { id: "google", label: "Gemini", hint: "aistudio.google.com → Get API key (AIza…)" },
  { id: "openai", label: "OpenAI", hint: "platform.openai.com → API keys (sk-…)" },
  { id: "xai", label: "Grok (xAI)", hint: "console.x.ai → API keys (xai-…)" },
  { id: "deepseek", label: "DeepSeek", hint: "platform.deepseek.com → API keys" },
  { id: "mistral", label: "Mistral", hint: "console.mistral.ai → API keys" },
  { id: "groq", label: "Groq", hint: "console.groq.com → API keys" },
  { id: "openrouter", label: "OpenRouter", hint: "openrouter.ai → Keys" },
];

export interface TeamKeyStatus {
  provider: string;
  label: string;
  hint: string;
  /** Where this team's key for it comes from now. */
  source: "team" | "server" | "none";
}

export class TeamKeys {
  constructor(
    private readonly settings: SettingsService,
    private readonly vault: VaultService,
    private readonly access: AccessControl,
  ) {}

  async status(
    user: User,
    teamId: string,
  ): Promise<{ keys: TeamKeyStatus[]; usesServerKeys: boolean }> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const usesServerKeys = await this.settings.serverKeysFor(teamId);
    const keys: TeamKeyStatus[] = [];
    for (const provider of TEAM_KEY_PROVIDERS) {
      const own = await this.settings.teamKey(teamId, provider.id);
      const server = !own && usesServerKeys && Boolean(await this.settings.apiKeyFor(provider.id));
      keys.push({
        provider: provider.id,
        label: provider.label,
        hint: provider.hint,
        source: own ? "team" : server ? "server" : "none",
      });
    }
    return { keys, usesServerKeys };
  }

  /** A team admin sets or replaces the team's key for a provider. */
  async set(user: User, teamId: string, provider: string, value: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const name = this.nameOf(provider);
    const key = value.trim();
    if (key.length < 10 || /\s/.test(key)) {
      throw ZelyqError.badRequest("That does not look like an API key. Paste the whole key.");
    }
    const scope = { kind: "team" as const, teamId };
    const existing = (await this.vault.list(user, scope)).find((entry) => entry.name === name);
    if (existing) {
      await this.vault.update(user, scope, existing.id, { value: key, protected: true });
    } else {
      await this.vault.create(user, scope, {
        name,
        value: key,
        description: `The team's ${this.labelOf(provider)} key, for its apps, Ops, voice and Studio.`,
        protected: true,
      });
    }
  }

  /** A team admin takes the team's key away: the team falls back to the server's, if it may. */
  async remove(user: User, teamId: string, provider: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const name = this.nameOf(provider);
    const scope = { kind: "team" as const, teamId };
    const existing = (await this.vault.list(user, scope)).find((entry) => entry.name === name);
    if (existing) await this.vault.remove(user, scope, existing.id);
  }

  private nameOf(provider: string): string {
    const name = TEAM_KEY_NAME[provider];
    if (!name) throw ZelyqError.badRequest(`Unknown AI provider: ${provider}.`);
    return name;
  }

  private labelOf(provider: string): string {
    return TEAM_KEY_PROVIDERS.find((one) => one.id === provider)?.label ?? provider;
  }
}
