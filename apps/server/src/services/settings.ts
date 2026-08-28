import type { SettingField, SettingsGroup, SettingsResponse } from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import { resolveSetting, type Store } from "@zelyq/db";
import {
  DEFAULT_CLAUDE_CREDENTIALS_PATH,
  DEFAULT_CODEX_CREDENTIALS_PATH,
  detectClaudeCodeSession,
  detectCodexSession,
  readClaudeCodeSession,
  readCodexSession,
} from "./cli-sessions.js";
import type { SecretBox } from "./secrets.js";
import { maskSecret } from "./secrets.js";

/**
 * One definition per setting, and the only list of them.
 *
 * Precedence is environment beats database beats default, unless the field
 * is `envOverridable`. Fields the environment supplies are returned as
 * `managedByEnv` so the UI shows them read-only, naming the variable, rather
 * than pretending they are editable — that lock is real protection for a
 * secret an operator pinned on purpose, or an access-control field like open
 * registration.
 *
 * `provider`, `model`, and `effort` are the exception. They are pure
 * model-choice, not a security posture, and every path that can read or
 * write them already requires an instance admin — the same person who could
 * have set the environment variable in the first place. Locking them meant
 * the only way to change which model Zelyq uses, once `.env` names one, was
 * to hand-edit that file and restart every process by hand — exactly the
 * "static settings" complaint the Settings page exists to prevent. For these
 * three, a value chosen through the UI wins; the environment is only ever
 * the bootstrap default.
 */
interface Definition {
  key: string;
  label: string;
  description: string;
  kind: SettingField["kind"];
  group: string;
  envVar: string;
  fallback: string;
  secret?: boolean;
  restartRequired?: boolean;
  envOverridable?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

const GROUPS: Array<{ name: string; description: string }> = [
  {
    name: "Model",
    description:
      "Which model builds your projects, and the key it uses. Only the selected provider's key is needed.",
  },
  {
    name: "Voice input",
    description:
      "Speech-to-text for the chat microphone. It uses the selected provider's API key from Model settings.",
  },
  {
    name: "Access",
    description: "Who may sign in, and for how long.",
  },
  {
    name: "Preview",
    description:
      "How running projects are reached. Change these when Zelyq is not on the machine you browse from.",
  },
  {
    name: "Runtime",
    description:
      "How and where the agent executes project code. Container-mode settings only apply when ZELYQ_RUNTIME=container.",
  },
];

const DEFINITIONS: Definition[] = [
  {
    key: "provider",
    label: "Provider",
    description: "The vendor the agent talks to.",
    kind: "select",
    group: "Model",
    envVar: "ZELYQ_PROVIDER",
    fallback: "anthropic",
    envOverridable: true,
    options: [
      { value: "anthropic", label: "Claude (Anthropic)" },
      { value: "google", label: "Gemini (Google)" },
      { value: "openai", label: "OpenAI" },
      { value: "xai", label: "Grok (xAI)" },
      { value: "deepseek", label: "DeepSeek" },
      { value: "mistral", label: "Mistral" },
      { value: "groq", label: "Groq" },
      { value: "openrouter", label: "OpenRouter" },
      { value: "custom", label: "Self-hosted or custom endpoint" },
    ],
  },
  {
    key: "anthropicApiKey",
    label: "Claude API key",
    description: "From console.anthropic.com. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "ANTHROPIC_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "sk-ant-…",
  },
  {
    // Set automatically by useAnthropicCliSession() below, and reset the
    // moment a real key is pasted — editable here too, as a plain way to
    // stop using a detected session without having to paste a throwaway
    // key just to flip it back.
    key: "anthropicAuthMode",
    label: "Claude auth mode",
    description: "Whether the key above is an API key or a Claude Code session.",
    kind: "select",
    group: "Model",
    envVar: "ZELYQ_ANTHROPIC_AUTH_MODE",
    fallback: "api_key",
    options: [
      { value: "api_key", label: "API key" },
      { value: "subscription", label: "Claude Code session" },
    ],
  },
  {
    key: "geminiApiKey",
    label: "Gemini API key",
    description: "From aistudio.google.com. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "GEMINI_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "AIza…",
  },
  {
    key: "openaiApiKey",
    label: "OpenAI API key",
    description: "From platform.openai.com. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "OPENAI_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "sk-…",
  },
  {
    // Same shape as anthropicAuthMode above, for a Codex "sign in with
    // ChatGPT" session.
    key: "openaiAuthMode",
    label: "OpenAI auth mode",
    description: "Whether the key above is an API key or a Codex session.",
    kind: "select",
    group: "Model",
    envVar: "ZELYQ_OPENAI_AUTH_MODE",
    fallback: "api_key",
    options: [
      { value: "api_key", label: "API key" },
      { value: "subscription", label: "Codex session" },
    ],
  },
  {
    key: "xaiApiKey",
    label: "Grok (xAI) API key",
    description: "From console.x.ai. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "XAI_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "xai-…",
  },
  {
    key: "deepseekApiKey",
    label: "DeepSeek API key",
    description: "From platform.deepseek.com. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "DEEPSEEK_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "sk-…",
  },
  {
    key: "mistralApiKey",
    label: "Mistral API key",
    description: "From console.mistral.ai. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "MISTRAL_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "optional",
  },
  {
    key: "groqApiKey",
    label: "Groq API key",
    description: "From console.groq.com. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "GROQ_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "gsk_…",
  },
  {
    key: "openrouterApiKey",
    label: "OpenRouter API key",
    description: "From openrouter.ai/keys. Stored encrypted; never shown again.",
    kind: "secret",
    group: "Model",
    envVar: "OPENROUTER_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "sk-or-…",
  },
  {
    key: "modelBaseUrl",
    label: "Model endpoint",
    description:
      "For a self-hosted or custom provider: the address of your OpenAI-compatible server, " +
      "such as http://localhost:11434/v1 for Ollama. Plaintext http is refused unless it is on " +
      "this machine, because your files would cross the network unencrypted.",
    kind: "text",
    group: "Model",
    envVar: "ZELYQ_MODEL_BASE_URL",
    fallback: "",
    placeholder: "http://localhost:11434/v1",
  },
  {
    key: "modelApiKey",
    label: "Model endpoint key",
    description:
      "Only if your endpoint requires one. A model on your own network usually does not.",
    kind: "secret",
    group: "Model",
    envVar: "ZELYQ_MODEL_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "optional",
  },
  {
    key: "model",
    label: "Model",
    description:
      "Leave empty to use the provider's default. A custom endpoint has no default — enter the " +
      "name your server reports.",
    kind: "text",
    group: "Model",
    envVar: "ZELYQ_MODEL",
    fallback: "",
    envOverridable: true,
    placeholder: "provider default",
  },
  {
    key: "effort",
    label: "Reasoning effort",
    description: "How hard the model thinks before answering. Higher costs more and is slower.",
    kind: "select",
    group: "Model",
    envVar: "ZELYQ_EFFORT",
    fallback: "high",
    envOverridable: true,
    options: ["low", "medium", "high", "xhigh", "max"].map((value) => ({ value, label: value })),
  },
  {
    key: "speechProvider",
    label: "Voice provider",
    description:
      "The speech-to-text service used by the chat microphone. OpenAI is available now; the provider boundary allows others to be added without changing the composer.",
    kind: "select",
    group: "Voice input",
    envVar: "ZELYQ_SPEECH_PROVIDER",
    fallback: "openai",
    options: [{ value: "openai", label: "OpenAI" }],
  },
  {
    key: "speechModel",
    label: "Voice model",
    description:
      "The transcription model sent to the selected provider. OpenAI Whisper uses whisper-1.",
    kind: "text",
    group: "Voice input",
    envVar: "ZELYQ_SPEECH_MODEL",
    fallback: "whisper-1",
    placeholder: "whisper-1",
  },
  {
    key: "allowRegistration",
    label: "Open registration",
    description:
      "Whether anyone who reaches this instance may create an account. Turn it off once your accounts exist.",
    kind: "boolean",
    group: "Access",
    envVar: "ZELYQ_ALLOW_REGISTRATION",
    fallback: "true",
  },
  {
    key: "sessionTtlDays",
    label: "Session length (days)",
    description: "How long a sign-in lasts before it has to be repeated.",
    kind: "number",
    group: "Access",
    envVar: "ZELYQ_SESSION_TTL_DAYS",
    fallback: "30",
  },
  {
    key: "previewHost",
    label: "Preview host",
    description:
      "The address project previews are advertised on. Set this to the host you browse to when Zelyq runs on a server.",
    kind: "text",
    group: "Preview",
    envVar: "ZELYQ_PREVIEW_HOST",
    fallback: "127.0.0.1",
    restartRequired: true,
  },
  {
    key: "containerEgressAllowlist",
    label: "Container egress allowlist",
    description:
      "Comma-separated hostnames a project's container may reach when ZELYQ_RUNTIME=container, e.g. " +
      "registry.npmjs.org,github.com. Leave empty and container egress is unfiltered — this is not a " +
      "security setting to turn on lightly, only a way to lock it down once you know what a project " +
      "needs. See docs/configuration.md.",
    kind: "text",
    group: "Runtime",
    envVar: "ZELYQ_CONTAINER_EGRESS_ALLOWLIST",
    fallback: "",
    placeholder: "registry.npmjs.org,github.com",
    restartRequired: true,
  },
];

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

/** Which stored secret belongs to which provider. */
const KEY_SETTING_BY_PROVIDER: Record<string, string> = {
  anthropic: "anthropicApiKey",
  google: "geminiApiKey",
  openai: "openaiApiKey",
  xai: "xaiApiKey",
  deepseek: "deepseekApiKey",
  mistral: "mistralApiKey",
  groq: "groqApiKey",
  openrouter: "openrouterApiKey",
  custom: "modelApiKey",
};

/**
 * Known-current model names per provider, offered as suggestions on the
 * `model` field — never a closed list, since that field stays free text.
 * Deliberately short: only names actually confirmed. Vendors with nothing
 * confirmed yet (or, like a custom endpoint, no catalog of their own to
 * confirm) are simply absent, same as leaving `models` unset in `apps/
 * agent/src/providers/index.ts`'s registry — kept in sync with that file by
 * hand today; unifying the two into one shared registry is real but
 * separate cleanup, not required to ship this.
 */
// Kept in sync with apps/agent/src/providers/index.ts by hand. Only models
// that do the full job this agent needs — multi-step tool calling,
// streaming, big context, and thinking where the provider supports it.
// Only IDs verified live (openai, google) or confirmed against the
// provider's own 2026 docs (anthropic, xai, deepseek, mistral).
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"],
  google: [
    "gemini-pro-latest",
    "gemini-2.5-pro",
    "gemini-3.7-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
  ],
  openai: ["gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-5-nano", "o4-mini"],
  xai: ["grok-4.6", "grok-4.5"],
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
  mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  groq: ["llama-3.3-70b-versatile"],
};

/**
 * Names people have actually reported typing for a Codex "sign in with
 * ChatGPT" session — not confirmed the way `MODEL_SUGGESTIONS` above is.
 * OpenAI's own Codex CLI, App, and VS Code extension all reject various
 * names here too ("The '<model>' model is not supported
 * when using Codex with a ChatGPT account"), for different people, on
 * different plans — a real OpenAI issue about it was closed "not planned",
 * meaning this looks like a deliberate, account/plan-dependent
 * restriction on their side, not a fixed list this can ever guess
 * correctly for everyone. Offered as somewhere to start trying, honestly
 * labelled — never presented as a confirmed default the way `anthropic`'s
 * list above is.
 */
export const CODEX_MODEL_CANDIDATES = ["gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.6-sol"];

export class SettingsService {
  /** Set when a restart-required setting changed since this process started. */
  private restartPending = false;

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly env: NodeJS.ProcessEnv = process.env,
    /** Overridable so tests point this at a fixture. */
    private readonly claudeCredentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
    /** Same, for Codex's session. */
    private readonly codexCredentialsPath: string = DEFAULT_CODEX_CREDENTIALS_PATH,
  ) {}

  /** The effective value, following environment → database → default. */
  async value(key: string): Promise<string> {
    const definition = BY_KEY.get(key);
    if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);

    // A secret's stored form is ciphertext, and a failed decrypt has its own
    // fallback — resolveSetting only knows plain strings, so this one case
    // keeps its own path rather than forcing a fit that isn't there.
    if (!definition.secret) {
      return await resolveSetting(
        this.store.settings,
        definition.envVar,
        key,
        definition.fallback,
        this.env,
        definition.envOverridable,
      );
    }

    const fromEnv = this.env[definition.envVar];
    if (fromEnv) return fromEnv;
    const stored = await this.store.settings.get(key);
    if (stored === null) return definition.fallback;
    return this.secrets.decrypt(stored) ?? definition.fallback;
  }

  async booleanValue(key: string): Promise<boolean> {
    return (await this.value(key)) !== "false";
  }

  async numberValue(key: string): Promise<number> {
    const parsed = Number.parseInt(await this.value(key), 10);
    return Number.isNaN(parsed) ? Number(BY_KEY.get(key)?.fallback ?? 0) : parsed;
  }

  /**
   * The API key for whichever provider is selected. When the provider's key
   * env var also happens to be set (a real deployment may
   * well have `OPENAI_API_KEY` pinned for the ordinary path), `value()`'s
   * own env-wins-first rule silently returned that key instead of a
   * connected subscription's stored credential — same setting name, wrong
   * value, and nothing about "subscription mode" involved in that check at
   * all. A subscription credential is never something an operator's env
   * var was ever meant to override; it goes straight to storage instead of
   * through the normal env-first `value()` path once `authModeFor` says so.
   */
  async apiKeyFor(provider: string): Promise<string> {
    const key = KEY_SETTING_BY_PROVIDER[provider] ?? "anthropicApiKey";
    if ((await this.authModeFor(provider)) === "subscription") {
      if (provider === "anthropic") {
        const session = await readClaudeCodeSession(this.claudeCredentialsPath);
        if (session && (!session.expiresAt || session.expiresAt > Date.now())) {
          return session.accessToken;
        }
      }
      return await this.storedSecretValue(key);
    }
    return await this.value(key);
  }

  /** Speech credentials deliberately ignore chat auth mode. A Codex
   * subscription token is not an OpenAI API key and cannot call the audio
   * transcription endpoint. */
  async speechApiKeyFor(provider: string): Promise<string> {
    const key = KEY_SETTING_BY_PROVIDER[provider];
    if (!key) return "";
    return await this.value(key);
  }

  /** A secret's stored, decrypted value only — never the environment
   * variable that would normally win for it. See `apiKeyFor` above. */
  private async storedSecretValue(key: string): Promise<string> {
    const definition = BY_KEY.get(key);
    if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);
    const stored = await this.store.settings.get(key);
    if (stored === null) return definition.fallback;
    return this.secrets.decrypt(stored) ?? definition.fallback;
  }

  /**
   * The model for whichever provider is actually active. A model an
   * operator's `ZELYQ_MODEL` pins, or one typed in earlier for a different
   * provider, must never leak into a newly-connected subscription. But
   * forcing empty unconditionally whenever subscription mode is active would
   * also block a model deliberately typed *for* the connected provider from
   * ever being used at all — nothing genuinely explicit could override it.
   * The real distinction is whether a model is truly *stored*, not which
   * mode is active: a stored value is a person's own deliberate choice,
   * regardless of provider or mode, and always wins; only the case where
   * nothing is stored — where the fallback would otherwise be an
   * env-pinned value meant for whatever provider was configured at
   * deploy time — gets forced empty for a connected subscription, so that
   * provider's own real default (or a clear "set one" refusal) applies
   * instead of silently borrowing a stranger's model.
   */
  async modelFor(provider: string): Promise<string> {
    const stored = await this.store.settings.get("model");
    if (stored !== null && stored !== "") return stored;
    if ((await this.authModeFor(provider)) === "subscription") return "";
    return await this.value("model");
  }

  /** Whether the key above is a classic API key or a CLI-sourced
   * subscription token. Only Anthropic and OpenAI have a mode to read yet. */
  async authModeFor(provider: string): Promise<"api_key" | "subscription"> {
    const settingKey =
      provider === "anthropic"
        ? "anthropicAuthMode"
        : provider === "openai"
          ? "openaiAuthMode"
          : null;
    if (!settingKey) return "api_key";
    const mode = await this.value(settingKey);
    return mode === "subscription" ? "subscription" : "api_key";
  }

  /** Whether a Claude Code session exists on this machine — existence only,
   * never reads its content. Safe to call every time Settings renders. */
  async detectAnthropicCliSession(): Promise<boolean> {
    return await detectClaudeCodeSession(this.claudeCredentialsPath);
  }

  /**
   * Reads Claude Code's own already-consented session and starts using it
   * in place of an API key. Throws a plain, specific error rather than a
   * generic failure — this is a real action someone clicked, not a
   * background check, and deserves an answer that says what actually
   * happened.
   */
  async useAnthropicCliSession(): Promise<{ subscriptionType?: string }> {
    const session = await readClaudeCodeSession(this.claudeCredentialsPath);
    if (!session) {
      throw ZelyqError.badRequest(
        "No Claude Code session found. Sign in with `claude` on this machine first.",
      );
    }
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      throw ZelyqError.badRequest(
        "That Claude Code session has expired. Sign in again with `claude`, then try this once more.",
      );
    }

    // Bypasses `update()` on purpose — that path resets this same mode back
    // to "api_key" the moment `anthropicApiKey` changes, which would undo
    // the very thing this method is setting.
    await this.store.settings.set("anthropicApiKey", this.secrets.encrypt(session.accessToken));
    await this.store.settings.set("anthropicAuthMode", "subscription");
    // "Use this instead" has to mean what it says. If connecting the session
    // did nothing to the separate `provider` setting, a turn would keep
    // running on whatever was already selected and the click would appear to
    // do nothing. `provider` is one of the three settings a stored value
    // always wins for regardless of the environment, so this is safe to set
    // unconditionally the same way picking it from the dropdown already
    // would be.
    await this.store.settings.set("provider", "anthropic");
    // A stale model must not ride into the wrong provider's request here —
    // see `modelFor` below for the lasting fix. Clearing `model` right here
    // on connect instead would also silently wipe out a model someone had
    // *already* typed in before clicking "Use this instead."

    return { subscriptionType: session.subscriptionType };
  }

  /** Whether a Codex "sign in with ChatGPT" session exists on this machine
   * — existence only. */
  async detectOpenaiCliSession(): Promise<boolean> {
    return await detectCodexSession(this.codexCredentialsPath);
  }

  /**
   * Reads Codex's own already-consented session and starts using it in
   * place of an API key. Unlike Claude's, this is genuinely unverified
   * against a live account — the request shape it will be used with is
   * researched, not confirmed working, and the caller should know that going
   * in, which is why the docs say so plainly rather than presenting this the
   * same way as Claude's already-proven path.
   */
  async useOpenaiCliSession(): Promise<{ accountId: string }> {
    const session = await readCodexSession(this.codexCredentialsPath);
    if (!session) {
      throw ZelyqError.badRequest(
        "No Codex session found. Sign in with `codex` (Sign in with ChatGPT) on this machine first.",
      );
    }

    // Packed as "<token>:<accountId>" — the agent's ChatGptResponsesProvider
    // needs both, and `apiKey` only ever carries one string; unpacked on
    // the other side in @zelyq/agent's chatgpt-responses.ts, which this
    // package cannot import (server and agent are separate processes, not
    // each other's dependency). Same bypass-update() reasoning as
    // useAnthropicCliSession above for why this writes directly.
    await this.store.settings.set(
      "openaiApiKey",
      this.secrets.encrypt(`${session.accessToken}:${session.accountId}`),
    );
    await this.store.settings.set("openaiAuthMode", "subscription");
    await this.store.settings.set("provider", "openai");

    return { accountId: session.accountId };
  }

  /** Everything the settings screen renders. Secrets are described, not sent. */
  async describe(): Promise<SettingsResponse> {
    const stored = await this.store.settings.all();
    // Read once, outside the loop below: the `model` field's suggestions
    // depend on whichever provider is actually in effect right now.
    const effectiveProvider = await this.value("provider");
    // A Codex session's valid model names are a different, unconfirmed set
    // from the ordinary OpenAI API's — see CODEX_MODEL_CANDIDATES above.
    const modelSuggestions =
      effectiveProvider === "openai" && (await this.authModeFor("openai")) === "subscription"
        ? CODEX_MODEL_CANDIDATES
        : MODEL_SUGGESTIONS[effectiveProvider];

    const fields = await Promise.all(
      DEFINITIONS.map(async (definition): Promise<SettingField> => {
        const fromEnv = this.env[definition.envVar];
        const hasStored = stored[definition.key] !== undefined && stored[definition.key] !== "";
        // An overridable field is never locked, and a stored choice outranks
        // the environment — so it is what "source" must say produced the
        // effective value, even while the environment also has one.
        const source = definition.envOverridable
          ? hasStored
            ? "database"
            : fromEnv
              ? "env"
              : "default"
          : fromEnv
            ? "env"
            : hasStored
              ? "database"
              : "default";
        const suggestions =
          definition.key === "model"
            ? modelSuggestions
            : definition.key === "speechModel" && (await this.value("speechProvider")) === "openai"
              ? ["whisper-1"]
              : undefined;

        const base = {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          kind: definition.kind,
          group: definition.group,
          source,
          envVar: definition.envVar,
          managedByEnv: !definition.envOverridable && Boolean(fromEnv),
          restartRequired: Boolean(definition.restartRequired),
          ...(definition.options ? { options: definition.options } : {}),
          ...(definition.placeholder ? { placeholder: definition.placeholder } : {}),
          ...(suggestions ? { suggestions } : {}),
        } as const;

        if (definition.secret) {
          const effective = await this.value(definition.key);
          return {
            ...base,
            // A secret's value never leaves the server, in any form that could
            // be used. Only whether one exists, and its last four characters.
            value: null,
            configured: effective.length > 0,
            ...(effective ? { hint: maskSecret(effective) } : {}),
          };
        }

        const effective = await this.value(definition.key);
        return {
          ...base,
          value:
            definition.kind === "boolean"
              ? effective !== "false"
              : definition.kind === "number"
                ? Number(effective)
                : effective,
        };
      }),
    );

    return {
      groups: GROUPS.map(
        (group): SettingsGroup => ({
          ...group,
          fields: fields.filter((field) => field.group === group.name),
        }),
      ),
      restartPending: this.restartPending,
    };
  }

  /**
   * Applies a batch of changes. An empty value clears the stored setting and
   * lets the environment or default take over again.
   */
  async update(changes: Record<string, string | number | boolean | null>): Promise<void> {
    for (const [key, raw] of Object.entries(changes)) {
      const definition = BY_KEY.get(key);
      if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);

      if (this.env[definition.envVar] && !definition.envOverridable) {
        throw new ZelyqError(
          "conflict",
          `${definition.label} is set by ${definition.envVar} in the environment. Remove it there to manage this setting here.`,
        );
      }

      const value = raw === null ? "" : String(raw).trim();

      if (value === "") {
        await this.store.settings.remove(key);
      } else if (definition.secret) {
        await this.store.settings.set(key, this.secrets.encrypt(value));
      } else {
        this.validate(definition, value);
        await this.store.settings.set(key, value);
      }

      // A real key pasted here — through this path, by a person typing —
      // always wins back from a detected subscription session.
      // useAnthropicCliSession()/useOpenaiCliSession() set the matching
      // *ApiKey too, but bypass this method entirely for exactly this
      // reason.
      if (key === "anthropicApiKey") {
        await this.store.settings.set("anthropicAuthMode", "api_key");
      }
      if (key === "openaiApiKey") {
        await this.store.settings.set("openaiAuthMode", "api_key");
      }

      if (definition.restartRequired) this.restartPending = true;
    }
  }

  private validate(definition: Definition, value: string): void {
    if (definition.options && !definition.options.some((option) => option.value === value)) {
      throw ZelyqError.badRequest(
        `${definition.label} must be one of: ${definition.options.map((o) => o.value).join(", ")}`,
      );
    }
    if (definition.kind === "number" && !/^\d+$/.test(value)) {
      throw ZelyqError.badRequest(`${definition.label} must be a whole number.`);
    }
  }
}
