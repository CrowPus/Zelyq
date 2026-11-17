import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

const SURFACE =
  "z-30 min-w-48 overflow-hidden rounded-lg border border-border-default bg-overlay p-1 shadow-overlay data-[state=open]:animate-[ui-pop-in_140ms_ease-out]";
const ITEM =
  "relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-hover";

/** A menu of actions, opened from a button. Keyboard and typeahead built in. */
export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  width,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  width?: string;
}) {
  return (
    <RadixMenu.Root modal={false}>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={`${SURFACE} ${width ?? ""}`}
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function MenuItem({
  icon,
  children,
  shortcut,
  onSelect,
  danger,
  disabled,
  asChild,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string;
  onSelect?(): void;
  danger?: boolean;
  disabled?: boolean;
  /** Render as the child element, for a link. */
  asChild?: boolean;
}) {
  if (asChild) {
    return (
      <RadixMenu.Item
        asChild
        disabled={disabled}
        onSelect={onSelect}
        className={`${ITEM} ${danger ? "text-danger" : ""}`}
      >
        {children}
      </RadixMenu.Item>
    );
  }
  return (
    <RadixMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`${ITEM} ${danger ? "text-danger data-[highlighted]:bg-danger-subtle" : ""}`}
    >
      {icon && (
        <span className="grid size-4 shrink-0 place-items-center text-fg-muted">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="text-xs text-fg-muted">{shortcut}</span>}
    </RadixMenu.Item>
  );
}

export function MenuCheckItem({
  checked,
  onSelect,
  children,
  hint,
}: {
  checked: boolean;
  onSelect(): void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <RadixMenu.CheckboxItem checked={checked} onSelect={onSelect} className={ITEM}>
      <span className="grid size-4 shrink-0 place-items-center">
        <RadixMenu.ItemIndicator>
          <Check size={14} strokeWidth={2} className="text-accent" />
        </RadixMenu.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </RadixMenu.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
      {children}
    </RadixMenu.Label>
  );
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="-mx-1 my-1 h-px bg-border-default" />;
}

export function SubMenu({
  label,
  icon,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixMenu.Sub>
      <RadixMenu.SubTrigger className={`${ITEM} data-[state=open]:bg-surface-hover`}>
        {icon && (
          <span className="grid size-4 shrink-0 place-items-center text-fg-muted">{icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={14} className="text-fg-muted" />
      </RadixMenu.SubTrigger>
      <RadixMenu.Portal>
        <RadixMenu.SubContent sideOffset={4} collisionPadding={8} className={SURFACE}>
          {children}
        </RadixMenu.SubContent>
      </RadixMenu.Portal>
    </RadixMenu.Sub>
  );
}

/** A floating panel for content that is not a list of actions (a form, a switcher). */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  side = "bottom",
  className = "",
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={`z-30 rounded-lg border border-border-default bg-overlay shadow-overlay focus:outline-none data-[state=open]:animate-[ui-pop-in_140ms_ease-out] ${className}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export const PopoverClose = RadixPopover.Close;
