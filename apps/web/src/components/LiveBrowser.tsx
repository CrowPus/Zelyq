import { Globe } from "lucide-react";
import { Spinner } from "./ui";

interface Props {
  /** Null when no tool is driving a browser — the panel renders nothing. */
  browser: {
    callId: string;
    label: string;
    frame: string | null;
    width: number;
    height: number;
    live: boolean;
  } | null;
}

/**
 * What the agent's browser is looking at, while it looks at it.
 *
 * A browser only exists for the length of one tool call, so this appears when
 * frames start and disappears when they stop rather than sitting empty. There
 * are no controls: this is a view of a page the agent is driving, and a click
 * here would have nowhere to go.
 */
export function LiveBrowser({ browser }: Props) {
  if (!browser) return null;

  return (
    <div className="flex min-h-0 flex-col border-t border-border-default bg-surface">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-default px-3">
        <Globe size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        <span className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
          Agent browser
        </span>
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted" title={browser.label}>
          {browser.label}
        </span>
        {browser.live && (
          <span className="flex shrink-0 items-center gap-1 text-2xs text-fg-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
            LIVE
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-hover p-2">
        {browser.frame ? (
          <img
            // Keyed on the call, not the frame: a new <img> per frame would
            // flash white between decodes. Swapping only the src lets the
            // browser paint the next frame over the last one.
            key={browser.callId}
            src={`data:image/jpeg;base64,${browser.frame}`}
            alt={`The agent's browser: ${browser.label}`}
            className="max-h-full max-w-full rounded border border-border-default object-contain"
          />
        ) : (
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner /> Opening the page…
          </span>
        )}
      </div>
    </div>
  );
}
