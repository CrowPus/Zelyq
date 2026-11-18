import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../../lib/i18n";

/**
 * The one dialog. Focus is trapped inside while it is open and returns to
 * whatever opened it; Escape and a click on the backdrop close it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  trigger,
}: {
  open?: boolean;
  onOpenChange?(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions, right-aligned: secondary first, primary last. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  trigger?: ReactNode;
}) {
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--backdrop)] data-[state=open]:animate-[ui-fade-in_150ms_ease-out]" />
        <RadixDialog.Content
          className={`fixed top-[12vh] left-1/2 z-40 flex max-h-[80vh] w-[calc(100vw-32px)] ${width} -translate-x-1/2 flex-col rounded-lg border border-border-default bg-overlay shadow-dialog focus:outline-none data-[state=open]:animate-[ui-dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]`}
        >
          <div className="flex items-start gap-3 border-b border-border-default px-5 py-4">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-lg font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-fg-secondary">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label={t("Close")}
              className="-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <X size={16} strokeWidth={1.75} />
            </RadixDialog.Close>
          </div>
          {children !== undefined && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-base text-fg">
              {children}
            </div>
          )}
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border-default bg-surface-subtle px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * A panel that slides in from the right edge, over the page, for work that
 * belongs beside what you were doing (Git, Variables, Snapshots, Docs).
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  actions,
  children,
  width = "md",
  modal = true,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "md" | "lg";
  /**
   * False for a panel to read beside the page (help): no backdrop, the page
   * stays usable, and a click on it does not close the panel. Escape and the
   * close button still do.
   */
  modal?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixDialog.Portal>
        {modal && (
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--backdrop)] data-[state=open]:animate-[ui-fade-in_150ms_ease-out]" />
        )}
        <RadixDialog.Content
          onInteractOutside={modal ? undefined : (event) => event.preventDefault()}
          className={`fixed inset-y-0 right-0 z-40 flex w-full ${width === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"} flex-col border-l border-border-default bg-overlay shadow-dialog focus:outline-none data-[state=open]:animate-[ui-drawer-in_220ms_cubic-bezier(0.16,1,0.3,1)]`}
        >
          <div className="flex items-start gap-3 border-b border-border-default px-5 py-4">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-lg font-semibold text-fg">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-fg-secondary">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            {actions}
            <RadixDialog.Close
              aria-label={t("Close")}
              className="-mr-2 grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <X size={16} strokeWidth={1.75} />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
