import { AsyncLocalStorage } from "node:async_hooks";
import type { SettingField, SettingsGroup, SettingsResponse } from "@zelyq/core";
import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  canonicalModelId,
  chooseAnthropicAutoModel,
  chooseGoogleAutoModel,
  chooseOpenAIAutoModel,
  cleanApiKey,
  DEFAULT_REGISTRY_URL,
  GOOGLE_DEFAULT_MODEL,
  GOOGLE_MODELS,
  imageProviderCatalog,
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODELS,
  vaultNameSchema,
  videoProviderCatalog,
  withAnthropicAuto,
  withGoogleAuto,
  withOpenAIAuto,
  ZelyqError,
} from "@zelyq/core";
import { resolveSetting, type Store } from "@zelyq/db";
import { z } from "zod";
import { AnthropicModelDiscovery, type AnthropicModelList } from "./anthropic-models.js";
import {
  DEFAULT_CLAUDE_CREDENTIALS_PATH,
  DEFAULT_CODEX_CREDENTIALS_PATH,
  detectClaudeCodeSession,
  detectCodexSession,
  readClaudeCodeSession,
  readCodexSession,
} from "./cli-sessions.js";
import { GoogleModelDiscovery, type GoogleModelList } from "./google-models.js";
import { OpenAIModelDiscovery, type OpenAIModelList } from "./openai-models.js";
import { automaticLocalConcurrency } from "./pipelines/capacity.js";
import { hostsOf, previewDomainProblem } from "./preview-domain.js";
import type { SecretBox } from "./secrets.js";
import { maskSecret } from "./secrets.js";
import { peekVault } from "./vault-peek.js";

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
    name: "Video Studio",
    description:
      "Choose video providers and add their API keys. Video generation is billed separately from images and your coding model.",
  },
  {
    name: "Image Studio",
    description:
      "Choose image providers and add their API keys. Image generation is independent of your coding model.",
  },
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
    name: "Interface",
    description: "What people see around their apps.",
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
  {
    name: "Pipelines",
    description: "Where runs-on: local pipelines run, and how long runs and artifacts are kept.",
  },
  {
    name: "Ops",
    description:
      "Ops, the team's DevOps engineer. It uses the provider above; its model can differ from the one that builds apps.",
  },
  {
    name: "Email",
    description:
      'The mail server Zelyq sends email through: Ops\'s alerts, approval and secret requests, and "it is live" messages. Send a test email after saving.',
  },
];

const DEFINITIONS: Definition[] = [
  {
    key: "videoProvider",
    label: "Default video provider",
    description: "The provider selected when you open Video Studio.",
    kind: "select",
    group: "Video Studio",
    envVar: "ZELYQ_VIDEO_GENERATION_PROVIDER",
    fallback: "google",
    envOverridable: true,
    options: Object.entries(videoProviderCatalog).map(([value, provider]) => ({
      value,
      label: provider.label,
    })),
  },
  ...(["google", "xai"] as const).flatMap((id): Definition[] => {
    const provider = videoProviderCatalog[id];
    const name = id === "google" ? "Google" : "Xai";
    return [
      {
        key: `video${name}ApiKey`,
        label: `${provider.label} video API key`,
        description:
          "Dedicated video API credential. Stored encrypted; generated clips are billed to this account.",
        kind: "secret",
        group: "Video Studio",
        envVar: `ZELYQ_VIDEO_${id.toUpperCase()}_API_KEY`,
        fallback: "",
        secret: true,
      },
      {
        key: `video${name}Model`,
        label: `${provider.label} video model`,
        description: "The supported model for new video generations.",
        kind: "select",
        group: "Video Studio",
        envVar: `ZELYQ_VIDEO_${id.toUpperCase()}_MODEL`,
        fallback: provider.models[0].value,
        envOverridable: true,
        options: [...provider.models],
      },
    ];
  }),
  {
    key: "videoHourlyLimit",
    label: "Video requests per hour",
    description:
      "Maximum submitted clips per user per rolling hour, including unconfirmed requests.",
    kind: "text",
    group: "Video Studio",
    envVar: "ZELYQ_VIDEO_HOURLY_LIMIT",
    fallback: "5",
    envOverridable: true,
  },
  {
    key: "videoSessionLimit",
    label: "Agent videos per conversation",
    description:
      "How many clips the build agent may generate in a single conversation. Deliberately much lower than the image limit: a clip costs far more, and a hero needs one, not six.",
    kind: "text",
    group: "Video Studio",
    envVar: "ZELYQ_VIDEO_SESSION_LIMIT",
    fallback: "2",
    envOverridable: true,
  },
  {
    key: "videoConcurrency",
    label: "Concurrent video jobs",
    description:
      "Outstanding provider jobs across this instance (1–10). Video slots are separate from image slots.",
    kind: "text",
    group: "Video Studio",
    envVar: "ZELYQ_VIDEO_CONCURRENCY",
    fallback: "2",
    envOverridable: true,
  },
  {
    key: "imageProvider",
    label: "Default image provider",
    description:
      "The provider selected when you open Image Studio. You can also choose a configured provider in Studio.",
    kind: "select",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_GENERATION_PROVIDER",
    fallback: "openai",
    envOverridable: true,
    options: Object.entries(imageProviderCatalog).map(([value, provider]) => ({
      value,
      label: provider.label,
    })),
  },
  {
    key: "imageGoogleApiKey",
    label: "Google image API key",
    description:
      "A Gemini API key from Google AI Studio. Used only for image generation; stored encrypted.",
    kind: "secret",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_GOOGLE_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "AIza…",
  },
  {
    key: "imageGoogleModel",
    label: "Google image model",
    description: "The Gemini image model used by Image Studio.",
    kind: "select",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_GOOGLE_MODEL",
    fallback: "gemini-3.1-flash-image",
    envOverridable: true,
    options: [...imageProviderCatalog.google.models],
  },
  {
    key: "imageXaiApiKey",
    label: "xAI image API key",
    description:
      "An xAI API key with image access. Used only for image generation; stored encrypted.",
    kind: "secret",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_XAI_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "xai-…",
  },
  {
    key: "imageXaiModel",
    label: "xAI image model",
    description: "The Grok image model used by Image Studio.",
    kind: "select",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_XAI_MODEL",
    fallback: "grok-imagine-image-2.0",
    envOverridable: true,
    options: [...imageProviderCatalog.xai.models],
  },

  {
    key: "imageHourlyLimit",
    label: "Image requests per hour",
    description:
      "How many images one user may request each hour, counting both Image Studio and the build agent. This is the spending limit; the right number depends on your provider's prices.",
    kind: "text",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_HOURLY_LIMIT",
    fallback: "30",
    envOverridable: true,
    placeholder: "30",
  },
  {
    key: "imageSessionLimit",
    label: "Agent images per conversation",
    description:
      "How many images the build agent may generate in a single conversation. Stops a retry loop, or an instruction hidden in a cloned repository, from spending an hour's budget in one turn.",
    kind: "text",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_SESSION_LIMIT",
    fallback: "6",
    envOverridable: true,
    placeholder: "6",
  },
  {
    key: "imageApiKey",
    label: "OpenAI image API key",
    description:
      "An OpenAI API key with image model access. Billed to this key; independent of chat subscriptions. Stored encrypted.",
    kind: "secret",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_API_KEY",
    fallback: "",
    secret: true,
    placeholder: "sk-…",
  },
  {
    key: "imageModel",
    label: "OpenAI image model",
    description: "The image model used for new generations.",
    kind: "select",
    group: "Image Studio",
    envVar: "ZELYQ_IMAGE_MODEL",
    fallback: "gpt-image-2",
    envOverridable: true,
    options: [...imageProviderCatalog.openai.models],
  },

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
    key: "anthropicWorkspaceId",
    label: "Claude workspace ID",
    description:
      "Only for an identity-linked (workspace-scoped) Claude API key — the console shows one on " +
      "the key. Sent as the anthropic-workspace-id header; leave empty for an ordinary key.",
    kind: "text",
    group: "Model",
    envVar: "ANTHROPIC_WORKSPACE_ID",
    fallback: "",
    placeholder: "wrkspc_…",
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
    key: "shareServerKeys",
    label: "Share this server's AI keys with every team",
    description:
      "Off: the AI keys set here serve only the teams a server admin belongs to; every other team adds its own on its Team page (AI keys). On: every team may use them, at your cost.",
    kind: "boolean",
    group: "Access",
    envVar: "ZELYQ_SHARE_SERVER_KEYS",
    envOverridable: true,
    fallback: "false",
  },
  {
    key: "showGitHubStar",
    label: "Show the GitHub star button",
    description:
      "A small Star button with Zelyq's star count in the top bar, and one thank-you card the first time someone's app is running. Turn it off for an instance where people should not see it.",
    kind: "boolean",
    group: "Interface",
    envVar: "ZELYQ_SHOW_GITHUB_STAR",
    envOverridable: true,
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
    key: "previewDomain",
    label: "Preview domain",
    description:
      "Serve every preview at its own name under this domain, e.g. shop-a1b2c3.zelyq.app, with no port opened. It needs a wildcard DNS record and certificate for the domain pointing at this server (deploy/enable-named-previews.sh does both). Use a domain of its own, never the app's. Takes effect at once; empty turns it off.",
    kind: "text",
    group: "Preview",
    envVar: "ZELYQ_PREVIEW_DOMAIN",
    // The admin portal sets it on a managed server; an operator's .env only seeds it.
    envOverridable: true,
    fallback: "",
    placeholder: "zelyq.app",
  },
  {
    key: "keepUndoPoints",
    label: "Undo points kept per app",
    description:
      "Zelyq saves an undo point before every AI turn. Each app keeps its newest this many; older ones are removed, and the newest is always kept. 0: keep every one.",
    kind: "number",
    group: "Runtime",
    envVar: "ZELYQ_KEEP_UNDO_POINTS",
    envOverridable: true,
    fallback: "30",
  },
  {
    key: "previewIdleMinutes",
    label: "Stop previews nobody uses after (minutes)",
    description:
      "A preview with no visit, no edit and no AI work for this many minutes is stopped, so its memory goes back to the server. Opening its address starts it again by itself. 0: never.",
    kind: "number",
    group: "Runtime",
    envVar: "ZELYQ_PREVIEW_IDLE_MINUTES",
    envOverridable: true,
    fallback: "0",
  },
  {
    key: "cleanIdleAfterDays",
    label: "Clear installed packages of idle apps after (days)",
    description:
      "An app nobody has opened, talked to or previewed for this many days has its installed packages and build caches (node_modules, Python environments, framework caches) removed to free disk. Nothing the person wrote is touched; the packages come back by themselves the next time its preview starts. 0: never.",
    kind: "number",
    group: "Runtime",
    envVar: "ZELYQ_CLEAN_IDLE_AFTER_DAYS",
    envOverridable: true,
    fallback: "14",
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
  {
    key: "pipelineLocalRunner",
    label: "Local runner",
    description:
      "Where pipelines with runs-on: local run. In a container: a fresh container per run, removed " +
      "afterwards (needs Docker on this server). On this server: directly, as the user Zelyq runs as, " +
      "with access to everything that user can reach — only for a machine you trust every editor with. " +
      "Off: only SSH runners.",
    kind: "select",
    group: "Pipelines",
    envVar: "ZELYQ_PIPELINE_LOCAL_RUNNER",
    envOverridable: true,
    fallback: "container",
    options: [
      { value: "container", label: "In a container" },
      { value: "host", label: "On this server (no container)" },
      { value: "off", label: "Off" },
    ],
  },
  {
    key: "pipelineLocalImage",
    label: "Local runner image",
    description:
      "The container image local runs start from. It needs sh and tar; the default also has bash, git, node and python3.",
    kind: "text",
    group: "Pipelines",
    envVar: "ZELYQ_PIPELINE_LOCAL_IMAGE",
    envOverridable: true,
    fallback: "node:22-bookworm",
    placeholder: "node:22-bookworm",
  },
  {
    key: "pipelineKeepRuns",
    label: "Runs kept per pipeline",
    description:
      "The newest finished runs of each pipeline that are kept, with their logs and artifacts; older ones are deleted once an hour. A pipeline's own keep: runs wins.",
    kind: "number",
    group: "Pipelines",
    envVar: "ZELYQ_PIPELINE_KEEP_RUNS",
    envOverridable: true,
    fallback: "100",
  },
  {
    key: "pipelineKeepArtifactsDays",
    label: "Days artifacts are kept",
    description: "Artifacts older than this are deleted. A pipeline's own keep: artifacts wins.",
    kind: "number",
    group: "Pipelines",
    envVar: "ZELYQ_PIPELINE_KEEP_ARTIFACTS_DAYS",
    envOverridable: true,
    fallback: "30",
  },
  {
    key: "pipelineLocalConcurrency",
    label: "Local runs at once",
    description: `How many local runs may run at the same time; the rest wait in line. 0 lets Zelyq choose from this server's processors and memory (${automaticLocalConcurrency()} here).`,
    kind: "number",
    group: "Pipelines",
    envVar: "ZELYQ_PIPELINE_LOCAL_CONCURRENCY",
    envOverridable: true,
    fallback: "0",
  },
  {
    key: "opsModel",
    label: "Ops model",
    description:
      "The model Ops thinks with. Empty: the provider's strongest default. Ops refuses models known to be too small for multi-step operations work.",
    kind: "text",
    group: "Ops",
    envVar: "ZELYQ_OPS_MODEL",
    envOverridable: true,
    fallback: "",
  },
  {
    key: "opsProvider",
    label: "Ops provider",
    description:
      "Who Ops thinks with when you type to it. Empty: the same as Settings → Model. Choosing one here changes Ops only, not the model Zelyq builds apps with.",
    kind: "select",
    group: "Ops",
    envVar: "ZELYQ_OPS_PROVIDER",
    envOverridable: true,
    fallback: "",
    options: [
      { value: "", label: "Same as Settings → Model" },
      { value: "google", label: "Google Gemini" },
      { value: "anthropic", label: "Anthropic Claude" },
      { value: "openai", label: "OpenAI" },
    ],
  },
  {
    key: "opsVoiceModel",
    label: "Ops voice model",
    description:
      "The Gemini Live model Ops talks with (it hears and speaks directly; no transcription). Uses the Google AI key in Settings → Model.",
    kind: "text",
    group: "Ops",
    envVar: "ZELYQ_OPS_VOICE_MODEL",
    envOverridable: true,
    fallback: "gemini-3.8-live",
  },
  {
    key: "opsVoice",
    label: "Ops voice",
    description: "The voice Ops speaks with when you talk to it live.",
    kind: "select",
    group: "Ops",
    envVar: "ZELYQ_OPS_VOICE",
    envOverridable: true,
    fallback: "Kore",
    options: ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"].map(
      (value) => ({ value, label: value }),
    ),
  },
  {
    key: "mailHost",
    label: "Mail server",
    description:
      'The SMTP server Zelyq sends email through (smtp.example.com): Ops\'s approval requests, secret requests and "it is live" messages. Empty: Zelyq sends no email.',
    kind: "text",
    group: "Email",
    envVar: "ZELYQ_MAIL_HOST",
    envOverridable: true,
    fallback: "",
    placeholder: "smtp.example.com",
  },
  {
    key: "mailPort",
    label: "Mail server port",
    description: "587 with STARTTLS is usual; 465 with TLS from the start.",
    kind: "number",
    group: "Email",
    envVar: "ZELYQ_MAIL_PORT",
    envOverridable: true,
    fallback: "587",
  },
  {
    key: "mailSecurity",
    label: "Mail connection",
    description: "How the connection to the mail server is protected.",
    kind: "select",
    group: "Email",
    envVar: "ZELYQ_MAIL_SECURITY",
    envOverridable: true,
    fallback: "starttls",
    options: [
      { value: "starttls", label: "STARTTLS (port 587)" },
      { value: "tls", label: "TLS from the start (port 465)" },
      { value: "none", label: "None (only on a private network)" },
    ],
  },
  {
    key: "mailUsername",
    label: "Mail username",
    description: "The account Zelyq signs in to the mail server with. Empty: no sign-in.",
    kind: "text",
    group: "Email",
    envVar: "ZELYQ_MAIL_USERNAME",
    envOverridable: true,
    fallback: "",
  },
  {
    key: "mailPassword",
    label: "Mail password",
    description: "Stored encrypted; never shown again.",
    kind: "secret",
    group: "Email",
    envVar: "ZELYQ_MAIL_PASSWORD",
    fallback: "",
    secret: true,
  },
  {
    key: "mailFrom",
    label: "Send email as",
    description:
      "The sender people see, such as Zelyq <ops@example.com>. The mail server must allow it.",
    kind: "text",
    group: "Email",
    envVar: "ZELYQ_MAIL_FROM",
    envOverridable: true,
    fallback: "",
    placeholder: "Zelyq <ops@example.com>",
  },
  {
    key: "publicUrl",
    label: "Public web address",
    description:
      "The address people open Zelyq at, such as https://zelyq.example.com. Links in email point here.",
    kind: "text",
    group: "Email",
    envVar: "ZELYQ_PUBLIC_URL",
    envOverridable: true,
    fallback: "",
    placeholder: "https://zelyq.example.com",
  },
  {
    key: "emailSignInLinks",
    label: "Password reset and invitations by email",
    description:
      'Adds "Forgot password?" to the sign-in page and lets a team invite people who have no account yet. Turn on only when this Zelyq runs on a server others can reach at the public address above: on your own computer the links would lead nowhere. Needs the mail server above.',
    kind: "boolean",
    group: "Email",
    envVar: "ZELYQ_EMAIL_SIGN_IN_LINKS",
    envOverridable: true,
    fallback: "false",
  },
  {
    key: "pluginRegistry",
    label: "Plugin registry",
    description:
      "Show Zelyq's own pipeline plugins in Pipelines → Plugins, ready to install. Every package is checked against Zelyq's signature before it is installed. Off: only plugins uploaded by hand.",
    kind: "boolean",
    group: "Pipelines",
    envVar: "ZELYQ_PLUGIN_REGISTRY",
    fallback: "true",
  },
  {
    key: "pluginRegistryUrl",
    label: "Plugin registry address",
    description: "Where the plugin registry is. Change it only if you run your own.",
    kind: "text",
    group: "Pipelines",
    envVar: "ZELYQ_PLUGIN_REGISTRY_URL",
    fallback: DEFAULT_REGISTRY_URL,
    placeholder: DEFAULT_REGISTRY_URL,
  },
];

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

/** Which stored secret belongs to which provider. */
/** How a provider is named on screen. */
const PROVIDER_NAME: Record<string, string> = {
  google: "Gemini",
  anthropic: "Claude",
  openai: "OpenAI",
};

/** Which team the current work is for (see SettingsService.forTeam). */
const teamContext = new AsyncLocalStorage<string>();

/**
 * What each team decides for itself: how its apps are built (provider, model,
 * effort, its own endpoint), Studio's providers and models, voice, and Ops's
 * brain and voice. Everything else runs the server, and is the server
 * admin's alone.
 */
/** A team's own mail server (Team settings → Email). */
export interface TeamMail {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username: string;
  /** Typed in (stored encrypted); empty when it comes from the team's Vault. */
  password: string;
  /** The team's Vault secret holding the password, read when mail goes out. */
  passwordVault: string | null;
  from: string;
}
export type TeamMailView = Omit<TeamMail, "password"> & { passwordSet: boolean };

export const teamMailInputSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1, "The mail server's address, such as smtp.example.com.")
      .max(255)
      .regex(/^[A-Za-z0-9.-]+$/, "Only the server's name, such as smtp.example.com."),
    port: z.number().int().min(1).max(65535).default(587),
    security: z.enum(["starttls", "tls", "none"]).default("starttls"),
    username: z.string().trim().max(255).default(""),
    password: z.string().max(1000).optional(),
    /** Take the password from this secret in the team's Vault instead. */
    passwordVault: vaultNameSchema.optional(),
    from: z.string().trim().min(3).max(320),
  })
  .strict();

function addressIn(from: string): string | null {
  const inside = /<([^>]+)>\s*$/.exec(from.trim());
  const address = (inside?.[1] ?? from).trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
}

export const TEAM_SETTINGS = new Set([
  "provider",
  "model",
  "effort",
  "modelBaseUrl",
  "anthropicWorkspaceId",
  "imageProvider",
  "imageModel",
  "imageGoogleModel",
  "imageXaiModel",
  "videoProvider",
  "videoGoogleModel",
  "videoXaiModel",
  "speechProvider",
  "speechModel",
  "opsProvider",
  "opsModel",
  "opsVoice",
  "opsVoiceModel",
]);

/** The name a team's own key for a provider has in its Vault. */
export const TEAM_KEY_NAME: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  custom: "MODEL_ENDPOINT_API_KEY",
};

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
  anthropic: ANTHROPIC_MODELS.map((model) => model.value),
  google: GOOGLE_MODELS.map((model) => model.value),
  openai: OPENAI_MODELS.map((model) => model.value),
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
/** Settings whose group has no section on the Settings page: they would be hidden. Must be empty. */
export function ungroupedSettings(): string[] {
  const named = new Set(GROUPS.map((group) => group.name));
  return DEFINITIONS.filter((definition) => !named.has(definition.group)).map(
    (definition) => `${definition.key} (${definition.group})`,
  );
}

export const CODEX_MODEL_CANDIDATES = OPENAI_MODELS.filter(
  (model) => model.group === "recommended" || model.value === "gpt-5.4",
).map((model) => model.value);

/** The default each curated catalog falls back to, for the Settings placeholder. */
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: OPENAI_DEFAULT_MODEL,
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  google: GOOGLE_DEFAULT_MODEL,
};

/**
 * A credential setting takes its value from a Vault — the instance's, or a
 * team's — when its stored form is this reference instead of ciphertext.
 * Ciphertext always starts with "v1.", so the two can never be confused.
 * `scope` is "instance" or a team id; a reference saved without one is the
 * instance's.
 */
export interface VaultReference {
  name: string;
  scope: string;
}
function vaultReference(stored: string | null | undefined): VaultReference | null {
  if (!stored?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(stored) as { vault?: unknown; scope?: unknown };
    if (typeof parsed.vault !== "string") return null;
    return {
      name: parsed.vault,
      scope: typeof parsed.scope === "string" ? parsed.scope : "instance",
    };
  } catch {
    return null;
  }
}

/** The settings key recording that credentials were copied out of the
 * environment once — after that, the environment is never read for them. */
const IMPORTED_FROM_ENV = "credentialsImportedFromEnvironment";

export class SettingsService {
  /** Set when a restart-required setting changed since this process started. */
  private restartPending = false;

  /**
   * How a Vault reference is resolved: the value of a name in a Vault
   * ("instance" or a team id), or null when it is not there. Attached at
   * start-up, once the Vault exists.
   */
  vaultLookup?: (reference: VaultReference) => Promise<string | null>;

  /** The strict sandbox is on: pipelines may never run on the server itself. */
  strictSandbox = false;

  /** The app's address from the server's own configuration, when it has one. */
  appPublicUrl?: string;

  private readonly changeListeners: Array<(keys: string[]) => void> = [];

  /** Told the keys that changed after every saved change (e.g. the preview domain). */
  onChange(listener: (keys: string[]) => void): void {
    this.changeListeners.push(listener);
  }

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly env: NodeJS.ProcessEnv = process.env,
    /** Overridable so tests point this at a fixture. */
    private readonly claudeCredentialsPath: string = DEFAULT_CLAUDE_CREDENTIALS_PATH,
    /** Same, for Codex's session. */
    private readonly codexCredentialsPath: string = DEFAULT_CODEX_CREDENTIALS_PATH,
    private readonly openAIModelDiscovery = new OpenAIModelDiscovery(),
    private readonly anthropicModelDiscovery = new AnthropicModelDiscovery(),
    private readonly googleModelDiscovery = new GoogleModelDiscovery(),
  ) {}

  // ------------------------------------------------------------ team settings

  /**
   * Runs work for one team: while it runs, a team setting (TEAM_SETTINGS)
   * reads the team's own choice first, and keys come from the team's own
   * first. Everything that reads settings inside, the model lists, endpoints
   * and keys included, follows without being told.
   */
  async forTeam<T>(teamId: string | null | undefined, work: () => Promise<T>): Promise<T> {
    return teamId ? await teamContext.run(teamId, work) : await work();
  }

  /** From here on in this piece of work, settings are read for this team. */
  enterTeam(teamId: string | null | undefined): void {
    if (teamId) teamContext.enterWith(teamId);
  }

  /** The team the current work is for, if any. */
  currentTeam(): string | null {
    return teamContext.getStore() ?? null;
  }

  private teamSettingKey(teamId: string, key: string): string {
    return `team:${teamId}:${key}`;
  }

  // ---------------------------------------------------------------- a team's own email

  /**
   * A team's own mail server (Team settings → Email), all or nothing: when a team
   * has one, every mail detail is the team's, and none is ever taken from the
   * server's (the server's password must never go to a server a team chose).
   * The password is stored encrypted. Null: the team has none.
   */
  async teamMail(teamId: string): Promise<TeamMail | null> {
    const raw = await this.store.settings.get(this.teamSettingKey(teamId, "mail"));
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as Omit<TeamMail, "password" | "passwordVault"> & {
        password?: string;
        passwordVault?: string | null;
      };
      if (!stored.host) return null;
      return {
        host: stored.host,
        port: stored.port,
        security: stored.security,
        username: stored.username ?? "",
        from: stored.from,
        password: stored.password ? (this.secrets.decrypt(stored.password) ?? "") : "",
        passwordVault: stored.passwordVault ?? null,
      };
    } catch {
      return null;
    }
  }

  /** What the team's page shows: everything but the password, which is only "set" or not. */
  async teamMailView(teamId: string): Promise<TeamMailView | null> {
    const mail = await this.teamMail(teamId);
    if (!mail) return null;
    const { password, ...rest } = mail;
    return { ...rest, passwordSet: password !== "" || mail.passwordVault !== null };
  }

  /** Saves a team's mail server. `password` left out keeps the one stored; "" clears it. */
  async setTeamMail(teamId: string, raw: unknown): Promise<void> {
    const input = teamMailInputSchema.parse(raw);
    if (!addressIn(input.from)) {
      throw ZelyqError.badRequest("Say who email is sent as, such as Acme <hello@acme.com>.");
    }
    const current = await this.store.settings.get(this.teamSettingKey(teamId, "mail"));
    const stored = current
      ? (JSON.parse(current) as { password?: string; passwordVault?: string | null })
      : {};
    // One source for the password: typed in, or a secret in the team's Vault.
    let password = stored.password ?? "";
    let passwordVault = stored.passwordVault ?? null;
    if (input.passwordVault !== undefined) {
      passwordVault = input.passwordVault;
      password = "";
    } else if (input.password !== undefined) {
      passwordVault = null;
      password = input.password === "" ? "" : this.secrets.encrypt(input.password);
    }
    await this.store.settings.set(
      this.teamSettingKey(teamId, "mail"),
      JSON.stringify({
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        from: input.from,
        password,
        passwordVault,
      }),
    );
  }

  async clearTeamMail(teamId: string): Promise<void> {
    await this.store.settings.remove(this.teamSettingKey(teamId, "mail"));
  }

  /** Only the team's own choices, for the team's settings page. */
  async teamValues(teamId: string): Promise<Record<string, string>> {
    const own: Record<string, string> = {};
    for (const key of TEAM_SETTINGS) {
      const value = await this.store.settings.get(this.teamSettingKey(teamId, key));
      if (value !== null && value !== "") own[key] = value;
    }
    return own;
  }

  /**
   * The team's settings page: the same fields as the server's, only those a
   * team decides, read for the team (its keys, its provider's models). Each
   * says whether the team chose it or it is the server's default.
   */
  async describeForTeam(teamId: string): Promise<SettingsResponse> {
    const own = await this.teamValues(teamId);
    const full = await this.forTeam(teamId, () => this.describe());
    return {
      groups: full.groups
        .map((group) => ({
          ...group,
          fields: group.fields
            .filter((field) => TEAM_SETTINGS.has(field.key))
            .map((field) => ({
              ...field,
              source: (field.key in own ? "database" : "default") as SettingField["source"],
              managedByEnv: false,
              restartRequired: false,
            })),
        }))
        .filter((group) => group.fields.length > 0),
      restartPending: false,
    };
  }

  /**
   * A team admin's changes to the team's own settings. Only team settings; an
   * empty value goes back to the server's default.
   */
  async updateForTeam(
    teamId: string,
    changes: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    for (const key of Object.keys(changes)) {
      if (!TEAM_SETTINGS.has(key)) {
        throw ZelyqError.badRequest(`${BY_KEY.get(key)?.label ?? key} is the server's to set.`);
      }
    }
    for (const [key, raw] of Object.entries(changes)) {
      const definition = BY_KEY.get(key) as Definition;
      const value = raw === null ? "" : String(raw).trim();
      const name = this.teamSettingKey(teamId, key);
      if (value === "") {
        await this.store.settings.remove(name);
        continue;
      }
      this.validate(definition, value);
      await this.store.settings.set(name, value);
    }
    // A model belongs to its provider: a new provider starts on its own default.
    if ("provider" in changes && !("model" in changes)) {
      await this.store.settings.remove(this.teamSettingKey(teamId, "model"));
    }
    if ("opsProvider" in changes && !("opsModel" in changes)) {
      await this.store.settings.remove(this.teamSettingKey(teamId, "opsModel"));
    }
  }

  /** The effective value, following environment → database → default. */
  async value(key: string): Promise<string> {
    const definition = BY_KEY.get(key);
    if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);
    // Working for a team: its own choice first, the server's when it made none.
    const team = teamContext.getStore();
    if (team && TEAM_SETTINGS.has(key)) {
      const own = await this.store.settings.get(this.teamSettingKey(team, key));
      if (own !== null && own !== "") return own;
    }

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

    // A credential is typed in Settings or taken from a Vault —
    // never read from the environment. What Settings shows is what is used.
    return await this.credential(definition);
  }

  private async credential(definition: Definition): Promise<string> {
    const stored = await this.store.settings.get(definition.key);
    if (stored === null) return definition.fallback;
    const reference = vaultReference(stored);
    if (reference !== null) return (await this.vaultLookup?.(reference)) ?? definition.fallback;
    return this.secrets.decrypt(stored) ?? definition.fallback;
  }

  /**
   * Points a credential field at a Vault secret (in the instance Vault or a
   * team's), or (with null) clears it. Typing a value instead goes through
   * `update`, which replaces a reference with ciphertext. Whether the person
   * may use that Vault is the route's to check.
   */
  async setCredentialSource(key: string, reference: VaultReference | null): Promise<void> {
    const definition = BY_KEY.get(key);
    if (!definition?.secret) throw ZelyqError.badRequest(`${key} is not a credential setting.`);
    if (reference === null) {
      await this.store.settings.remove(key);
      return;
    }
    if ((await peekVault(async () => this.vaultLookup?.(reference))) == null) {
      throw ZelyqError.badRequest(`${reference.name} is not in that Vault.`);
    }
    await this.store.settings.set(
      key,
      JSON.stringify({ vault: reference.name, scope: reference.scope }),
    );
    // As with a pasted key: a key chosen here wins back from a subscription.
    if (key === "anthropicApiKey") await this.store.settings.set("anthropicAuthMode", "api_key");
    if (key === "openaiApiKey") await this.store.settings.set("openaiAuthMode", "api_key");
  }

  /** Every credential field pointing into one Vault ("instance" or a team
   * id) — for that Vault's "where used". */
  async vaultUsages(scope: string): Promise<{ key: string; label: string; vaultName: string }[]> {
    const stored = await this.store.settings.all();
    const uses = DEFINITIONS.flatMap((definition) => {
      const reference = definition.secret ? vaultReference(stored[definition.key]) : null;
      return reference && reference.scope === scope
        ? [{ key: definition.key, label: definition.label, vaultName: reference.name }]
        : [];
    });
    // A team's own email can take its password from the team's Vault.
    if (scope !== "instance") {
      const mail = await this.teamMail(scope);
      if (mail?.passwordVault) {
        uses.push({
          key: "teamMailPassword",
          label: "Team email password",
          vaultName: mail.passwordVault,
        });
      }
    }
    return uses;
  }

  /**
   * Credentials used to come from the server's environment (`.env`). They are
   * copied into Settings once, as typed values, so nothing is lost; after
   * that the environment is never read for them, and clearing one in
   * Settings stays cleared. Returns the variable names it copied, for the log.
   */
  async importCredentialsFromEnvironment(): Promise<string[]> {
    if ((await this.store.settings.get(IMPORTED_FROM_ENV)) !== null) return [];
    const copied: string[] = [];
    for (const definition of DEFINITIONS) {
      if (!definition.secret) continue;
      const fromEnv = this.env[definition.envVar]?.trim();
      if (!fromEnv) continue;
      if ((await this.store.settings.get(definition.key)) !== null) continue;
      await this.store.settings.set(definition.key, this.secrets.encrypt(fromEnv));
      copied.push(definition.envVar);
    }
    await this.store.settings.set(IMPORTED_FROM_ENV, new Date().toISOString());
    return copied;
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
  async apiKeyFor(provider: string, given?: string | null): Promise<string> {
    return cleanApiKey(await this.rawApiKeyFor(provider, given));
  }

  private async rawApiKeyFor(provider: string, given?: string | null): Promise<string> {
    const teamId = given ?? teamContext.getStore() ?? null;
    // A team's own key first; the server's only for a team allowed to use it.
    if (teamId) {
      const own = await this.teamKey(teamId, provider);
      if (own) return own;
      if (!(await this.serverKeysFor(teamId))) return "";
    }
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
  async speechApiKeyFor(provider: string, given?: string | null): Promise<string> {
    const teamId = given ?? teamContext.getStore() ?? null;
    if (teamId) {
      const own = await this.teamKey(teamId, provider);
      if (own) return own;
      if (!(await this.serverKeysFor(teamId))) return "";
    }
    const key = KEY_SETTING_BY_PROVIDER[provider];
    if (!key) return "";
    return await this.value(key);
  }

  /**
   * A team's own key for a provider: the Vault entry of that provider's name
   * (ANTHROPIC_API_KEY, GEMINI_API_KEY, …) in the team's Vault. Empty when it
   * has none.
   */
  async teamKey(teamId: string, provider: string): Promise<string> {
    if (!TEAM_KEY_NAME[provider] || !this.vaultLookup) return "";
    const name = await this.teamKeyName(teamId, provider);
    return ((await this.vaultLookup({ name, scope: teamId })) ?? "").trim();
  }

  /**
   * Which secret in the team's Vault holds its key for a provider: one the
   * team chose ("From Vault"), or the provider's usual name (a pasted key).
   */
  async teamKeyName(teamId: string, provider: string): Promise<string> {
    const chosen = await this.store.settings.get(this.teamSettingKey(teamId, `keyref:${provider}`));
    return chosen || (TEAM_KEY_NAME[provider] as string);
  }

  /** The secret the team chose for a provider's key, if it chose one; null to stop. */
  async chosenTeamKey(teamId: string, provider: string): Promise<string | null> {
    return await this.store.settings.get(this.teamSettingKey(teamId, `keyref:${provider}`));
  }

  async chooseTeamKey(teamId: string, provider: string, vaultName: string | null): Promise<void> {
    const name = this.teamSettingKey(teamId, `keyref:${provider}`);
    if (vaultName) await this.store.settings.set(name, vaultName);
    else await this.store.settings.remove(name);
  }

  /**
   * Whether a team may use the server's own AI keys: every team when the
   * server shares them, else only a team a server admin belongs to (the
   * owner's own teams keep working with no setup at all).
   */
  async serverKeysFor(teamId: string): Promise<boolean> {
    if (await this.booleanValue("shareServerKeys")) return true;
    for (const member of await this.store.teams.listMembers(teamId)) {
      const user = await this.store.users.findById(member.userId);
      if (user?.instanceRole === "admin") return true;
    }
    return false;
  }

  /**
   * A media key (Studio's image and video providers have their own fields):
   * the team's own first, then the server's field when the team may use it.
   */
  async mediaKeyFor(setting: string, provider: string, given?: string | null): Promise<string> {
    const teamId = given ?? teamContext.getStore() ?? null;
    if (teamId) {
      const own = await this.teamKey(teamId, provider);
      if (own) return own;
      if (!(await this.serverKeysFor(teamId))) return "";
    }
    return (await this.value(setting)).trim();
  }

  /** A secret's stored, decrypted value only — never the environment
   * variable that would normally win for it. See `apiKeyFor` above. */
  private async storedSecretValue(key: string): Promise<string> {
    const definition = BY_KEY.get(key);
    if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);
    return await this.credential(definition);
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
    if (this.inheritedFromAnotherStartupProvider(provider)) return "";
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
    // A sign-in on this machine (Claude Pro, ChatGPT) is the server owner's own.
    // A team with its own key, or one not given the server's keys, uses an API key.
    const team = teamContext.getStore();
    if (team && ((await this.teamKey(team, provider)) || !(await this.serverKeysFor(team)))) {
      return "api_key";
    }
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

  /**
   * True when Settings now names `provider`, but `ZELYQ_MODEL` /
   * `ZELYQ_MODEL_BASE_URL` were set at boot for a *different* provider. Those
   * defaults belong to the vendor they were written for; forwarding them would
   * point one provider's key at another's endpoint, or pin a model name that
   * provider has never heard of.
   */
  private inheritedFromAnotherStartupProvider(provider: string): boolean {
    return Boolean(this.env.ZELYQ_PROVIDER && this.env.ZELYQ_PROVIDER !== provider);
  }

  async googleBaseUrl(): Promise<string> {
    const fallback = "https://generativelanguage.googleapis.com";
    if (this.env.ZELYQ_MODEL_BASE_URL && this.inheritedFromAnotherStartupProvider("google"))
      return fallback;
    return (await this.value("provider")) === "google"
      ? (await this.value("modelBaseUrl")) || fallback
      : fallback;
  }

  /** Shared by Settings and the project chat. Gemini has no subscription mode. */
  async googleModels(): Promise<GoogleModelList> {
    const result = await this.googleModelDiscovery.list(
      await this.apiKeyFor("google"),
      await this.googleBaseUrl(),
    );
    return { ...result, models: withGoogleAuto(result.models) as GoogleModelList["models"] };
  }

  async resolveGoogleModel(typed: string): Promise<string> {
    const model = canonicalModelId(typed, GOOGLE_MODELS);
    if (model && model !== "auto") return model;
    const catalog = await this.googleModels();
    const chosen = chooseGoogleAutoModel(catalog.models);
    if (!chosen)
      throw ZelyqError.badRequest(
        "This Gemini API key lists no supported models. Check model access in Settings.",
      );
    return chosen;
  }

  async anthropicBaseUrl(): Promise<string> {
    const fallback = "https://api.anthropic.com";
    if (this.env.ZELYQ_MODEL_BASE_URL && this.inheritedFromAnotherStartupProvider("anthropic"))
      return fallback;
    return (await this.value("provider")) === "anthropic"
      ? (await this.value("modelBaseUrl")) || fallback
      : fallback;
  }

  /**
   * Shared by Settings and the project chat. A connected Claude Code session
   * authenticates with an OAuth token, not an API key — it is never sent to
   * the public models endpoint, exactly as a Codex session never is.
   */
  async anthropicModels(): Promise<AnthropicModelList> {
    if ((await this.authModeFor("anthropic")) === "subscription") {
      return {
        models: ANTHROPIC_MODELS.filter((model) => model.group === "recommended"),
        modelAvailability: "subscription",
        modelNotice:
          "Claude subscription candidates; access depends on your plan. Choose a model supported by your Claude account.",
      };
    }
    const result = await this.anthropicModelDiscovery.list(
      await this.apiKeyFor("anthropic"),
      await this.anthropicBaseUrl(),
    );
    return { ...result, models: withAnthropicAuto(result.models) as AnthropicModelList["models"] };
  }

  async resolveAnthropicModel(typed: string): Promise<string> {
    const model = canonicalModelId(typed, ANTHROPIC_MODELS);
    if (model && model !== "auto") return model;
    if ((await this.authModeFor("anthropic")) === "subscription") {
      if (model === "auto")
        throw ZelyqError.badRequest(
          "Choose an explicit model for your Claude subscription in Settings or project chat.",
        );
      return "";
    }
    const catalog = await this.anthropicModels();
    const chosen = chooseAnthropicAutoModel(catalog.models);
    if (!chosen)
      throw ZelyqError.badRequest(
        "This Anthropic API key lists no supported Claude models. Check model access in Settings.",
      );
    return chosen;
  }

  async openAIBaseUrl(): Promise<string> {
    // A boot-time custom endpoint belongs to that boot-time provider. Switching
    // to OpenAI in Settings must not send its key to the previous vendor.
    if (this.env.ZELYQ_MODEL_BASE_URL && this.inheritedFromAnotherStartupProvider("openai"))
      return "https://api.openai.com/v1";
    return (await this.value("provider")) === "openai"
      ? (await this.value("modelBaseUrl")) || "https://api.openai.com/v1"
      : "https://api.openai.com/v1";
  }

  /** Shared by Settings and the project chat; subscription access is separate. */
  async openAIModels(): Promise<OpenAIModelList> {
    if ((await this.authModeFor("openai")) === "subscription") {
      return {
        models: OPENAI_MODELS.filter((model) => CODEX_MODEL_CANDIDATES.includes(model.value)),
        modelAvailability: "subscription",
        modelNotice:
          "ChatGPT subscription candidates; access depends on your plan. Choose a model supported by your Codex account.",
      };
    }
    const result = await this.openAIModelDiscovery.list(
      await this.apiKeyFor("openai"),
      await this.openAIBaseUrl(),
    );
    return { ...result, models: withOpenAIAuto(result.models) };
  }

  async resolveOpenAIModel(typed: string): Promise<string> {
    const model = canonicalModelId(typed, OPENAI_MODELS);
    if (model && model !== "auto") return model;
    if ((await this.authModeFor("openai")) === "subscription") {
      if (model === "auto")
        throw ZelyqError.badRequest(
          "Choose an explicit model for your ChatGPT subscription in Settings or project chat.",
        );
      return "";
    }
    // Explicit choices stay pinned. Auto and empty defaults adapt to listed access.
    const catalog = await this.openAIModels();
    const chosen = chooseOpenAIAutoModel(catalog.models);
    if (!chosen)
      throw ZelyqError.badRequest(
        "This OpenAI API key lists no supported coding models. Check model access in Settings.",
      );
    return chosen;
  }

  /** Everything the settings screen renders. Secrets are described, not sent. */
  async describe(): Promise<SettingsResponse> {
    // Showing Settings is not using the credentials it points at.
    return await peekVault(() => this.describeNow());
  }

  private async describeNow(): Promise<SettingsResponse> {
    const stored = await this.store.settings.all();
    // Read once, outside the loop below: the `model` field's suggestions
    // depend on whichever provider is actually in effect right now.
    const effectiveProvider = await this.value("provider");
    // A Codex session's valid model names are a different, unconfirmed set
    // from the ordinary OpenAI API's — see CODEX_MODEL_CANDIDATES above.
    // Whichever provider has a curated catalog with live access checks. The
    // rest still get the plain `MODEL_SUGGESTIONS` datalist.
    const catalog =
      effectiveProvider === "openai"
        ? await this.openAIModels()
        : effectiveProvider === "anthropic"
          ? await this.anthropicModels()
          : effectiveProvider === "google"
            ? await this.googleModels()
            : undefined;
    const modelSuggestions = catalog
      ? catalog.models.map((model) => model.value)
      : MODEL_SUGGESTIONS[effectiveProvider];
    // Ops may think with its own provider: its model list is that provider's, read from its key.
    const opsProvider = (await this.value("opsProvider")).trim() || effectiveProvider;
    const opsCatalog =
      opsProvider === effectiveProvider
        ? catalog
        : opsProvider === "openai"
          ? await this.openAIModels()
          : opsProvider === "anthropic"
            ? await this.anthropicModels()
            : opsProvider === "google"
              ? await this.googleModels()
              : undefined;

    const fields = await Promise.all(
      DEFINITIONS.map(async (definition): Promise<SettingField> => {
        const inheritedOtherModel =
          definition.key === "model" &&
          Boolean(catalog) &&
          this.inheritedFromAnotherStartupProvider(effectiveProvider);
        // Credentials are never read from the environment, so it supplies
        // none of them and locks none of them.
        const fromEnv =
          inheritedOtherModel || definition.secret ? undefined : this.env[definition.envVar];
        const reference = definition.secret ? vaultReference(stored[definition.key]) : null;
        const hasStored = stored[definition.key] !== undefined && stored[definition.key] !== "";
        // An overridable field is never locked, and a stored choice outranks
        // the environment — so it is what "source" must say produced the
        // effective value, even while the environment also has one.
        const source = reference
          ? "vault"
          : definition.envOverridable
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
          ...(definition.key === "model" && catalog
            ? {
                modelOptions: catalog.models,
                modelNotice: catalog.modelNotice,
                placeholder:
                  catalog.modelAvailability === "subscription"
                    ? `Enter a supported ${effectiveProvider === "openai" ? "Codex" : "Claude"} model`
                    : `Default: ${DEFAULT_MODEL_BY_PROVIDER[effectiveProvider]}`,
              }
            : {}),
          ...(definition.key === "opsModel" && opsCatalog
            ? {
                modelOptions: opsCatalog.models,
                modelNotice: opsCatalog.modelNotice,
                placeholder: `Default: the strongest ${PROVIDER_NAME[opsProvider] ?? opsProvider} model your key can use`,
              }
            : {}),
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
            ...(reference
              ? {
                  vaultName: reference.name,
                  vaultScope: reference.scope,
                  vaultMissing: effective.length === 0,
                }
              : {}),
          };
        }

        const effective =
          definition.key === "model" && catalog
            ? await this.modelFor(effectiveProvider)
            : await this.value(definition.key);
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
    // Switching to a provider with a curated catalog starts on Auto rather
    // than inheriting the previous provider's model name or endpoint.
    const previousProvider = await this.value("provider");
    const switchingToCurated =
      typeof changes.provider === "string" &&
      ["openai", "anthropic", "google"].includes(changes.provider) &&
      changes.provider !== previousProvider
        ? changes.provider
        : undefined;
    // Everything is checked before anything is written: a refused key never
    // leaves the keys before it saved and the rest not.
    for (const [key, raw] of Object.entries(changes)) {
      const definition = BY_KEY.get(key);
      if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);
      if (!definition.secret && this.env[definition.envVar] && !definition.envOverridable) {
        throw new ZelyqError(
          "conflict",
          `${definition.label} is set by ${definition.envVar} in the environment. Remove it there to manage this setting here.`,
        );
      }
      const value = raw === null ? "" : String(raw).trim();
      if (value !== "" && !definition.secret) this.validate(definition, value);
    }
    if ("previewDomain" in changes || "publicUrl" in changes) {
      const problem = await this.previewDomainProblem({
        ...("previewDomain" in changes
          ? { previewDomain: String(changes.previewDomain ?? "").trim() }
          : {}),
        ...("publicUrl" in changes ? { publicUrl: String(changes.publicUrl ?? "").trim() } : {}),
      });
      if (problem) throw ZelyqError.badRequest(problem);
    }
    try {
      await this.write(changes, switchingToCurated);
    } finally {
      for (const listener of this.changeListeners) listener(Object.keys(changes));
    }
  }

  private async write(
    changes: Record<string, string | number | boolean | null>,
    switchingToCurated: string | undefined,
  ): Promise<void> {
    for (const [key, raw] of Object.entries(changes)) {
      const definition = BY_KEY.get(key);
      if (!definition) throw ZelyqError.badRequest(`Unknown setting: ${key}`);

      if (!definition.secret && this.env[definition.envVar] && !definition.envOverridable) {
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
    if (switchingToCurated) {
      if (!("model" in changes) && (await this.authModeFor(switchingToCurated)) === "api_key")
        await this.store.settings.set("model", "auto");
      if (!("modelBaseUrl" in changes)) await this.store.settings.remove("modelBaseUrl");
    }
  }

  /**
   * Why the preview domain (the one given, or the one saved) may not be used
   * with the app's address (the one given, or every one known), or null.
   * Checked when either changes and at start, so an address set later, or a
   * value seeded from the environment, is held to the same rule.
   */
  async previewDomainProblem(
    next: { previewDomain?: string; publicUrl?: string } = {},
  ): Promise<string | null> {
    const domain = (next.previewDomain ?? (await this.value("previewDomain"))).toLowerCase();
    if (!domain) return null;
    const publicUrl = next.publicUrl ?? (await this.value("publicUrl").catch(() => ""));
    return previewDomainProblem(
      domain,
      hostsOf([publicUrl, this.env.ZELYQ_PUBLIC_URL, this.appPublicUrl]),
      this.env.ZELYQ_ALLOW_SAME_SITE_PREVIEWS === "true",
    );
  }

  private validate(definition: Definition, value: string): void {
    if (definition.key === "previewDomain") {
      if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
        throw ZelyqError.badRequest(
          "Preview domain must be a domain name, such as zelyq.app: lower case, no https:// and no path.",
        );
      }
    }
    if (definition.key === "pipelineLocalRunner" && value === "host" && this.strictSandbox) {
      throw ZelyqError.badRequest(
        "This server keeps every team's code in a sandbox, so pipelines cannot run on the server itself.",
      );
    }
    if (["videoHourlyLimit", "videoConcurrency"].includes(definition.key)) {
      const max = definition.key === "videoConcurrency" ? 10 : 1000;
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
        throw ZelyqError.badRequest(
          `${definition.label} must be a whole number between 1 and ${max}.`,
        );
    }
    if (definition.options && !definition.options.some((option) => option.value === value)) {
      throw ZelyqError.badRequest(
        `${definition.label} must be one of: ${definition.options.map((o) => o.value).join(", ")}`,
      );
    }
    if (definition.kind === "number" && !/^\d+$/.test(value)) {
      throw ZelyqError.badRequest(`${definition.label} must be a whole number.`);
    }
    if (definition.key === "publicUrl" && value.trim() && !publicAddress(value)) {
      throw ZelyqError.badRequest(
        `${definition.label} must be a web address starting with https:// or http://, such as https://zelyq.example.com.`,
      );
    }
  }
}

/**
 * The public web address, cleaned: scheme and host only, no trailing slash.
 * Null when it is not a usable http(s) address. Links in email are built from
 * this and nothing else, never from the request's own Host header, which
 * anyone can set.
 */
export function publicAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
