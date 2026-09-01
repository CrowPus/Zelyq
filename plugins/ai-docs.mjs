import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * 060 — `fetch_provider_docs`.
 *
 * The `ai-providers/` notes are pinned to a date; provider SDKs move. This
 * tool pulls the current official quickstart / API reference so a build can
 * confirm the exact call shape. It is NOT a general web fetch — the host must
 * be on the documentation allowlist below. When it cannot get what is needed,
 * it says so and tells the model to ask the user to paste the snippet, which
 * the build then records in `architecture/ai.md` (or `docs/<provider>-notes.md`).
 *
 * Fetch and cache are agent-side (Node `fetch` + `node:fs`), not through the
 * project runtime — documentation is agent infrastructure, not project data,
 * and this must work even for a project with no runtime egress. Cached on disk
 * for a week so repeat builds are fast and mostly offline-capable.
 */

const ALLOW = [
  "platform.openai.com",
  "docs.anthropic.com",
  "docs.claude.com",
  "ai.google.dev",
  "docs.mistral.ai",
  "console.groq.com",
  "docs.x.ai",
  "openrouter.ai",
  "www.npmjs.com",
  "registry.npmjs.org",
  "github.com",
  "raw.githubusercontent.com",
];

/** Best-effort default landing page per provider slug. A `topic` or an
 * explicit `url` overrides. */
const PROVIDER_DOCS = {
  openai: "https://platform.openai.com/docs/api-reference/chat",
  anthropic: "https://docs.claude.com/en/api/messages",
  google: "https://ai.google.dev/gemini-api/docs/text-generation",
  mistral: "https://docs.mistral.ai/api/",
  groq: "https://console.groq.com/docs/api-reference",
  xai: "https://docs.x.ai/docs/api-reference",
  openrouter: "https://openrouter.ai/docs/api-reference/overview",
  "openai-compatible": "https://github.com/ollama/ollama/blob/main/docs/openai.md",
};

const CACHE_DIR = process.env.ZELYQ_DOC_CACHE_DIR || path.join(os.tmpdir(), "zelyq-doc-cache");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHARS = 12_000;

function allowed(hostname) {
  return ALLOW.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cacheRead(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.txt`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > TTL_MS) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function cacheWrite(key, text) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.txt`), text);
  } catch {
    // A non-writable cache dir is not a failure — just no caching.
  }
}

const ASK_USER =
  "Ask the user to paste the exact SDK usage snippet or a working docs link for this provider, " +
  "then record it in architecture/ai.md (or docs/<provider>-notes.md) and build from that.";

export default [
  {
    name: "fetch_provider_docs",
    description:
      "Fetch an LLM provider's official quickstart / API reference to confirm the current SDK " +
      "call shape before wiring a model into a build. Give a `provider` slug (openai, anthropic, " +
      "google, mistral, groq, xai, openrouter, openai-compatible) for its default docs page, or " +
      "an explicit `url` on the documentation allowlist. Returns readable text (cached on disk " +
      "for a week). If it cannot retrieve what is needed, it tells you to ask the user to paste " +
      "the snippet — do that, do not guess the API.",
    schema: z.object({
      provider: z
        .enum([
          "openai",
          "anthropic",
          "google",
          "mistral",
          "groq",
          "xai",
          "openrouter",
          "openai-compatible",
        ])
        .optional(),
      url: z.string().url().optional(),
      topic: z.string().max(120).optional().describe("A hint for what you need, e.g. 'streaming'"),
    }),
    async run(_context, input) {
      const url = input.url || (input.provider ? PROVIDER_DOCS[input.provider] : undefined);
      if (!url) {
        return {
          output: `No \`url\` and no known \`provider\` given. ${ASK_USER}`,
        };
      }
      let hostname;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return { output: `Not a valid URL: ${url}. ${ASK_USER}`, isError: true };
      }
      if (!allowed(hostname)) {
        return {
          output:
            `${hostname} is not on the documentation allowlist ` +
            `(${ALLOW.join(", ")}). ${ASK_USER}`,
          isError: true,
        };
      }

      const key = crypto.createHash("sha1").update(url).digest("hex");
      const cached = cacheRead(key);
      if (cached) {
        let source;
        try {
          source = new URL(url).hostname;
        } catch {
          source = "the docs page";
        }
        return { output: `# ${url}  (cached)\n\n${cached}`, untrusted: { source } };
      }

      let res;
      try {
        res = await fetch(url, {
          signal: AbortSignal.timeout(20_000),
          headers: { "user-agent": "ZelyqAgent/1 (documentation fetch)" },
        });
      } catch (error) {
        return { output: `Could not reach ${url}: ${error.message}. ${ASK_USER}` };
      }
      if (!res.ok) {
        return { output: `${url} returned HTTP ${res.status}. ${ASK_USER}` };
      }
      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();
      let text = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
      if (input.topic) {
        // Keep the section around the first mention of the topic, plus context.
        const at = text.toLowerCase().indexOf(input.topic.toLowerCase());
        if (at > 2000) text = `… [earlier content trimmed]\n\n${text.slice(at - 800)}`;
      }
      if (text.length > MAX_CHARS) {
        text = `${text.slice(0, MAX_CHARS)}\n\n… [truncated — fetch a more specific page, or ask the user for the exact snippet]`;
      }
      cacheWrite(key, text);
      // A fetched documentation page — text from a host the user does not
      // control (finding E1). Allowlisted hosts, but still data, not orders.
      let source;
      try {
        source = new URL(url).hostname;
      } catch {
        source = "the docs page";
      }
      return { output: `# ${url}\n\n${text}`, untrusted: { source } };
    },
  },
];
