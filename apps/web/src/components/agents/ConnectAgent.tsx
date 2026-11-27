import { Check, Copy, Plug } from "lucide-react";
import { type ReactNode, useState } from "react";
import { t } from "../../lib/i18n";
import { BrandIcon } from "../BrandIcon";
import { Button, IconButton } from "../ui";

type Client = "claude" | "connector" | "cursor" | "vscode" | "gemini" | "other";

const CLIENTS: { id: Client; label: string; icon: ReactNode }[] = [
  { id: "claude", label: t("Claude Code"), icon: <BrandIcon brand="claudecode" size={12} /> },
  {
    id: "connector",
    label: t("Claude.ai / ChatGPT"),
    icon: (
      <>
        <BrandIcon brand="claude" size={12} />
        <BrandIcon brand="openai" size={12} />
      </>
    ),
  },
  { id: "cursor", label: t("Cursor"), icon: <BrandIcon brand="cursor" size={12} /> },
  { id: "vscode", label: t("VS Code"), icon: <BrandIcon brand="vscode" size={12} /> },
  { id: "gemini", label: t("Gemini CLI"), icon: <BrandIcon brand="geminicli" size={12} /> },
  { id: "other", label: t("Any MCP client"), icon: <Plug size={12} aria-hidden /> },
];

/** The gateway's address on this instance. */
export function gatewayUrl(): string {
  return `${window.location.origin}/agent-gateway/mcp`;
}

/**
 * The key, once, with how to plug it into the agent the person uses. Every
 * snippet carries the real key so it can be pasted as is.
 */
export function ConnectAgent({
  name,
  agentKey,
  onClose,
}: {
  name: string;
  agentKey: string;
  onClose: () => void;
}) {
  const [client, setClient] = useState<Client>("claude");
  const url = gatewayUrl();
  const header = `Bearer ${agentKey}`;
  const snippets: Record<Client, { where: string; text: string }> = {
    claude: {
      where: t("Run this once in a terminal:"),
      text: `claude mcp add --transport http zelyq ${url} \\\n  --header "Authorization: ${header}"`,
    },
    cursor: {
      where: t("Add to .cursor/mcp.json (in a project, or in your home folder for all of them):"),
      text: JSON.stringify(
        { mcpServers: { zelyq: { url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    vscode: {
      where: t("Add to .vscode/mcp.json:"),
      text: JSON.stringify(
        { servers: { zelyq: { type: "http", url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    gemini: {
      where: t("Add to ~/.gemini/settings.json:"),
      text: JSON.stringify(
        { mcpServers: { zelyq: { httpUrl: url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    connector: {
      where: t(
        "Claude.ai and ChatGPT sign in instead of sending a key. Add a custom connector with this address; when it opens Zelyq’s sign-in page, paste the key above.",
      ),
      text: url,
    },
    other: {
      where: t("Any client that speaks MCP over HTTP (Streamable HTTP) and can send a header:"),
      text: t("URL:     {url}\nHeader:  Authorization: {header}", { url, header }),
    },
  };
  const snippet = snippets[client];

  return (
    <div
      role="status"
      className="mb-5 grid gap-3 rounded-lg border border-success/30 bg-success-subtle p-3.5"
    >
      <div>
        <p className="text-xs font-medium text-fg">
          {t("Key for “{name}”. Copy it now — it will not be shown again.", { name })}
        </p>
        <p className="mt-0.5 text-2xs text-fg-secondary">
          {t(
            "The agent uses its own model and subscription. Zelyq only lends it hands on the apps you chose.",
          )}
        </p>
      </div>
      <CopyBlock value={agentKey} label={t("Copy key")} />

      <div>
        <div className="mb-1.5 flex flex-wrap gap-1" role="tablist" aria-label={t("Agent")}>
          {CLIENTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={client === option.id}
              onClick={() => setClient(option.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-2xs ${
                client === option.id ? "bg-surface text-fg shadow-sm" : "text-fg-secondary"
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
        <p className="mb-1 text-2xs text-fg-secondary">{snippet.where}</p>
        <CopyBlock value={snippet.text} label={t("Copy")} multiline />
        <p className="mt-1.5 text-2xs text-fg-muted">
          {t("Then ask the agent to call {code}: it learns its apps and what it may do.", {
            code: <code>my_job</code>,
          })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("I have copied it")}
        </Button>
      </div>
    </div>
  );
}

export function CopyBlock({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border-default bg-surface px-2 py-1.5">
      {multiline ? (
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-2xs leading-relaxed text-fg">
          {value}
        </pre>
      ) : (
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">{value}</code>
      )}
      <IconButton
        size="sm"
        label={copied ? t("Copied") : label}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
      </IconButton>
    </div>
  );
}
