import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../ui";

type Client = "claude" | "connector" | "cursor" | "vscode" | "gemini" | "other";

const CLIENTS: { id: Client; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "connector", label: "Claude.ai / ChatGPT" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "other", label: "Any MCP client" },
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
      where: "Run this once in a terminal:",
      text: `claude mcp add --transport http zelyq ${url} \\\n  --header "Authorization: ${header}"`,
    },
    cursor: {
      where: "Add to .cursor/mcp.json (in a project, or in your home folder for all of them):",
      text: JSON.stringify(
        { mcpServers: { zelyq: { url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    vscode: {
      where: "Add to .vscode/mcp.json:",
      text: JSON.stringify(
        { servers: { zelyq: { type: "http", url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    gemini: {
      where: "Add to ~/.gemini/settings.json:",
      text: JSON.stringify(
        { mcpServers: { zelyq: { httpUrl: url, headers: { Authorization: header } } } },
        null,
        2,
      ),
    },
    connector: {
      where:
        "Claude.ai and ChatGPT sign in instead of sending a key. Add a custom connector with this address; when it opens Zelyq's sign-in page, paste the key above.",
      text: url,
    },
    other: {
      where: "Any client that speaks MCP over HTTP (Streamable HTTP) and can send a header:",
      text: `URL:     ${url}\nHeader:  Authorization: ${header}`,
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
          Key for “{name}”. Copy it now — it will not be shown again.
        </p>
        <p className="mt-0.5 text-2xs text-fg-secondary">
          The agent uses its own model and subscription. Zelyq only lends it hands on the apps you
          chose.
        </p>
      </div>
      <CopyBlock value={agentKey} label="Copy key" />

      <div>
        <div className="mb-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Agent">
          {CLIENTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={client === option.id}
              onClick={() => setClient(option.id)}
              className={`rounded px-2 py-0.5 text-2xs ${
                client === option.id ? "bg-surface text-fg shadow-sm" : "text-fg-secondary"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mb-1 text-2xs text-fg-secondary">{snippet.where}</p>
        <CopyBlock value={snippet.text} label="Copy" multiline />
        <p className="mt-1.5 text-2xs text-fg-muted">
          Then ask the agent to call <code>my_job</code>: it learns its apps and what it may do.
        </p>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          I have copied it
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
        label={copied ? "Copied" : label}
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
