import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { flagSvg, globeSvg } from "../lib/flags";

/*
 * The flags and globe are fixed drawings from lib/flags (no outside input),
 * so writing them as markup is safe.
 */

/** A language's flag; nothing for a language without one. */
export function Flag({ tag }: { tag: string }) {
  const id = useId();
  const svg = flagSvg(tag, id);
  if (!svg) return <span className="inline-block w-5 shrink-0" aria-hidden />;
  return (
    <span
      className="inline-flex shrink-0"
      aria-hidden
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed drawing from lib/flags
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The turning globe that says "language". */
export function Globe({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-flex w-5 shrink-0 justify-center"
      aria-hidden
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed drawing from lib/flags
      dangerouslySetInnerHTML={{ __html: globeSvg("globe", size) }}
    />
  );
}

export interface LanguageOption {
  value: string;
  name: string;
  /** The tag its flag and lang attribute follow; none shows the globe. */
  tag?: string;
}

const ITEM =
  "relative flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-hover";

/**
 * Choose a language from a list with flags. `compact` is the quiet one under a
 * sign-in form (globe and name); otherwise it looks like a select field.
 */
export function LanguageMenu({
  value,
  options,
  onChange,
  label,
  compact,
}: {
  value: string;
  options: LanguageOption[];
  onChange(value: string): void;
  label: string;
  compact?: boolean;
}) {
  const chosen = options.find((option) => option.value === value) ?? options[0]!;
  return (
    <RadixMenu.Root modal={false}>
      <RadixMenu.Trigger
        aria-label={`${label}: ${chosen.name}`}
        className={
          compact
            ? "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] focus-visible:outline-none data-[state=open]:bg-surface-hover data-[state=open]:text-fg"
            : "flex h-8 w-full items-center gap-2.5 rounded-md border border-border-control bg-surface pr-2.5 pl-2.5 text-left text-sm text-fg transition-[border-color,box-shadow] duration-100 hover:border-fg-muted focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] focus-visible:outline-none"
        }
      >
        {compact ? (
          <Globe size={16} />
        ) : chosen.tag ? (
          <Flag tag={chosen.tag} />
        ) : (
          <Globe size={16} />
        )}
        <span className="min-w-0 flex-1 truncate" lang={chosen.tag}>
          {chosen.name}
        </span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-fg-muted" />
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={compact ? "center" : "start"}
          sideOffset={6}
          collisionPadding={8}
          className="z-30 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-lg border border-border-default bg-overlay p-1 shadow-overlay data-[state=open]:animate-[ui-pop-in_140ms_ease-out]"
        >
          <RadixMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <RadixMenu.RadioItem key={option.value} value={option.value} className={ITEM}>
                {option.tag ? <Flag tag={option.tag} /> : <Globe size={16} />}
                <span className="min-w-0 flex-1 truncate" lang={option.tag}>
                  {option.name}
                </span>
                <RadixMenu.ItemIndicator>
                  <Check size={14} strokeWidth={2} className="text-accent" />
                </RadixMenu.ItemIndicator>
              </RadixMenu.RadioItem>
            ))}
          </RadixMenu.RadioGroup>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
