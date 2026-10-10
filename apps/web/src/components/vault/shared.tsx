import { useMutation, useQuery } from "@tanstack/react-query";
import type { VaultImportResult, VaultVersion } from "@zelyq/core";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelative, REVEAL_SECONDS, vaultErrorMessage } from "../../lib/vault";
import { Badge, Button, IconButton, Spinner, Textarea } from "../ui";

/**
 * A revealed value, with copy, that hides itself after half a minute so it is
 * not left on a screen someone walks away from.
 */
export function RevealedValue({ value, onHide }: { value: string; onHide: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = setTimeout(onHide, REVEAL_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [onHide]);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border-default bg-surface-subtle px-2 py-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
      <IconButton
        size="sm"
        label={copied ? "Copied" : "Copy value"}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
      </IconButton>
      <span className="text-2xs text-fg-muted">hides in {REVEAL_SECONDS}s</span>
    </div>
  );
}

/** The versions a value has had, with Restore for the ones that are not current. */
export function VersionHistory({
  queryKey,
  load,
  restore,
  canRestore,
  onRestored,
  note,
}: {
  queryKey: unknown[];
  load: () => Promise<VaultVersion[]>;
  restore: (version: number) => Promise<unknown>;
  canRestore: boolean;
  onRestored: () => Promise<void>;
  note: string;
}) {
  const versions = useQuery({ queryKey, queryFn: load });
  const run = useMutation({ mutationFn: restore, onSuccess: onRestored });
  return (
    <div className="mt-2 rounded-md border border-border-default bg-surface-subtle p-2">
      {versions.isPending && <Spinner className="size-3" />}
      {versions.data?.length === 0 && <p className="text-xs text-fg-muted">No typed values yet.</p>}
      {versions.data && versions.data.length > 0 && (
        <ol className="grid gap-1">
          {versions.data.map((version) => (
            <li key={version.version} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-mono">v{version.version}</span>
                <span className="text-fg-muted">
                  {" "}
                  · {version.createdBy?.name ?? "Zelyq"} · {formatRelative(version.createdAt)}
                </span>
              </span>
              {version.current ? (
                <Badge tone="success">current</Badge>
              ) : (
                canRestore && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run.mutate(version.version)}
                    disabled={run.isPending}
                  >
                    Restore
                  </Button>
                )
              )}
            </li>
          ))}
        </ol>
      )}
      {run.isError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {vaultErrorMessage(run.error)}
        </p>
      )}
      <p className="mt-1.5 text-2xs text-fg-muted">{note}</p>
    </div>
  );
}

/** Paste or choose a `.env` file — a one-time way to move existing keys in. */
export function ImportForm({
  title,
  run,
  onImported,
  onClose,
}: {
  title: string;
  run: (input: { content: string; overwrite: boolean }) => Promise<{ result: VaultImportResult }>;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<VaultImportResult | null>(null);
  const submit = useMutation({
    mutationFn: () => run({ content, overwrite }),
    onSuccess: async ({ result }) => {
      setResult(result);
      setContent("");
      await onImported();
    },
  });
  return (
    <form
      className="mb-4 grid gap-3 rounded-lg border border-border-default bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-2xs text-fg-muted">
          A one-time way to bring existing keys in. The file is not kept.
        </p>
      </div>
      <Textarea
        rows={6}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={"STRIPE_KEY_TEST=sk_test_…\nOPENAI_API_KEY=sk-…"}
        className="font-mono text-xs"
        spellCheck={false}
        aria-label=".env content"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          Replace ones that already exist
        </label>
        <label className="cursor-pointer text-xs text-fg-secondary underline-offset-2 hover:underline">
          Or choose a file
          <input
            type="file"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setContent(await file.text());
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {submit.isError && (
        <p role="alert" className="text-xs text-danger">
          {vaultErrorMessage(submit.error)}
        </p>
      )}
      {result && (
        <div role="status" className="grid gap-1 text-xs">
          {result.created.length > 0 && <p>Added: {result.created.join(", ")}</p>}
          {result.updated.length > 0 && <p>Replaced: {result.updated.join(", ")}</p>}
          {result.skipped.length > 0 && (
            <ul className="text-fg-secondary">
              {result.skipped.map((item) => (
                <li key={item.name}>
                  Skipped <span className="font-mono">{item.name}</span>: {item.reason}
                </li>
              ))}
            </ul>
          )}
          {result.created.length + result.updated.length === 0 && <p>Nothing was imported.</p>}
        </div>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {result ? "Done" : "Cancel"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!content.trim() || submit.isPending}
        >
          {submit.isPending ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}
