import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

/** Mounted once at the root, so every tooltip shares one open/close delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

/**
 * A real tooltip: appears on hover and on keyboard focus, styled, and read by
 * screen readers. Replaces the native `title` attribute, which is slow,
 * unstyled, and never shown on a touch screen.
 */
export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  if (!content) return children;
  // Its own provider, so a tooltip works wherever the component is rendered
  // (a test, a portal), not only under the app's root.
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[70] flex max-w-xs items-center gap-2 rounded-md bg-strong px-2 py-1 text-xs font-medium text-strong-fg shadow-overlay data-[state=delayed-open]:animate-[ui-fade-in_120ms_ease-out]"
          >
            {content}
            {shortcut && (
              <kbd className="rounded-sm border border-white/20 px-1 font-sans text-2xs opacity-75">
                {shortcut}
              </kbd>
            )}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
