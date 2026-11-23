import { type User, ZelyqError } from "@zelyq/core";
import type { AccessControl } from "./access.js";
import { type SettingsService, TEAM_KEY_NAME } from "./settings.js";
import type { VaultService } from "./vault.js";
import { peekVault } from "./vault-peek.js";

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
  {
    id: "custom",
    label: "Custom endpoint",
    hint: "the key of your own OpenAI-compatible endpoint (Team settings → Model endpoint)",
  },
];

export interface TeamKeyStatus {
  provider: string;
  label: string;
  hint: string;
  /** Where this team's key for it comes from now. */
  source: "team" | "server" | "none";
  /** The team Vault secret it was pointed at ("From Vault"), if any. */
  vaultName: string | null;
  /** That secret is gone or empty: the key no longer works. */
  vaultMissing: boolean;
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
    // Showing which keys are set is not using them.
    return await peekVault(() => this.statusOf(teamId));
  }

  /** The team's AI keys that come from its Vault — for that Vault's "where used". */
  async vaultUsages(teamId: string): Promise<{ key: string; label: string; vaultName: string }[]> {
    const uses: { key: string; label: string; vaultName: string }[] = [];
    for (const provider of TEAM_KEY_PROVIDERS) {
      uses.push({
        key: `teamKey:${provider.id}`,
        label: `AI key · ${provider.label}`,
        vaultName: await this.settings.teamKeyName(teamId, provider.id),
      });
    }
    return uses;
  }

  private async statusOf(
    teamId: string,
  ): Promise<{ keys: TeamKeyStatus[]; usesServerKeys: boolean }> {
    const usesServerKeys = await this.settings.serverKeysFor(teamId);
    const keys: TeamKeyStatus[] = [];
    for (const provider of TEAM_KEY_PROVIDERS) {
      const own = await this.settings.teamKey(teamId, provider.id);
      const server = !own && usesServerKeys && Boolean(await this.settings.apiKeyFor(provider.id));
      const chosen = await this.settings.chosenTeamKey(teamId, provider.id);
      keys.push({
        provider: provider.id,
        label: provider.label,
        hint: provider.hint,
        source: own ? "team" : server ? "server" : "none",
        vaultName: chosen,
        vaultMissing: Boolean(chosen) && !own,
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
    // A pasted key replaces a Vault secret chosen before.
    await this.settings.chooseTeamKey(teamId, provider, null);
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

  /**
   * A team admin points the team's key at a secret already in its Vault: only
   * the name is kept, the value is read when it is used and never shown.
   */
  async useVault(user: User, teamId: string, provider: string, vaultName: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    this.nameOf(provider);
    const scope = { kind: "team" as const, teamId };
    await this.vault.requireUse(user, scope, vaultName);
    const value = await peekVault(async () =>
      (await this.vault.resolve(teamId, [vaultName])).get(vaultName),
    );
    if (!value?.trim()) throw ZelyqError.badRequest(`${vaultName} is empty in the team's Vault.`);
    await this.settings.chooseTeamKey(teamId, provider, vaultName);
  }

  /** A team admin takes the team's key away: the team falls back to the server's, if it may. */
  async remove(user: User, teamId: string, provider: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    // A secret chosen from the Vault is the team's own: stop using it, never delete it.
    if (await this.settings.chosenTeamKey(teamId, provider)) {
      await this.settings.chooseTeamKey(teamId, provider, null);
      return;
    }
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
