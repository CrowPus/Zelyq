import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./ui";

interface Props {
  provider: "anthropic" | "openai";
  onUsed?: () => void;
}

const COPY: Record<Props["provider"], { cliName: string; found: string; caution?: string }> = {
  anthropic: {
    cliName: "Claude Code",
    found: "A Claude Code session was found on this machine.",
  },
  openai: {
    cliName: "Codex",
    found: "A Codex session was found on this machine.",
    // Honest, not equal: unlike Claude's proven path, this speaks a private
    // endpoint OpenAI never published
    // for outside use. Real, but not verified against a live account the
    // way Claude's is.
    caution:
      "Unverified: this uses a private OpenAI endpoint, not their public API. It may not work, and could stop working if OpenAI changes it.",
  },
};

/**
 * "Use your CLI session instead".
 * Detection is a plain existence check, safe to run whenever this renders.
 * The actual read only ever happens on the explicit click below, and it
 * goes straight into the same encrypted storage an API key already uses —
 * nothing new to trust here beyond what pasting a key already required.
 */
export function CliSessionControl({ provider, onUsed }: Props) {
  const copy = COPY[provider];

  const detected = useQuery({
    queryKey: ["cli-session", provider],
    queryFn: () => api.detectCliSession(provider),
    staleTime: 30_000,
  });

  const use = useMutation({
    mutationFn: () => api.connectCliSession(provider),
    onSuccess: () => onUsed?.(),
  });

  if (detected.isLoading || !detected.data?.found) return null;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-fg-secondary">
          <KeyRound size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
          {copy.found}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => use.mutate()}
          disabled={use.isPending}
        >
          {use.isPending ? "Connecting…" : "Use this instead"}
        </Button>
        {use.isSuccess && (
          <span className="flex shrink-0 items-center gap-1 text-2xs text-success">
            <CircleCheck size={12} strokeWidth={1.75} /> Connected
          </span>
        )}
        {use.isError && (
          <span className="flex shrink-0 items-center gap-1 text-2xs text-danger" role="alert">
            <CircleAlert size={12} strokeWidth={1.75} /> {(use.error as Error).message}
          </span>
        )}
      </div>
      {copy.caution && (
        <p className="flex items-start gap-1.5 pl-[21px] text-2xs text-warning">
          <TriangleAlert size={11} strokeWidth={1.75} className="mt-px shrink-0" />
          {copy.caution}
        </p>
      )}
    </div>
  );
}
