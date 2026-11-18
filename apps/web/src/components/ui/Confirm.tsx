import { type ReactNode, useEffect, useRef, useState } from "react";
import { Toaster as SonnerToaster, toast } from "sonner";
import { useTheme } from "../../hooks/useTheme.js";
import { t } from "../../lib/i18n";
import { Button } from "./Button.js";
import { Dialog } from "./Dialog.js";
import { Input } from "./Field.js";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** The button's words: name the action ("Delete app"), never "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
  /** Ask the person to type this (an app or team name) before confirming. */
  typeToConfirm?: string;
  /** Ask for a line of text instead (resolves to it, or null on cancel). */
  input?: { label: string; defaultValue?: string; placeholder?: string };
}

type Pending = ConfirmOptions & { resolve(ok: boolean | string | null): void };

let open: ((request: Pending) => void) | null = null;

/**
 * Ask before doing something. A drop-in for `window.confirm`, but styled,
 * translatable, keyboard-safe, and able to require the name of what is about
 * to be lost:
 *
 *   if (!(await confirmAction({ title: "Delete this app?", danger: true }))) return;
 */
export function confirmAction(options: Omit<ConfirmOptions, "input">): Promise<boolean> {
  return new Promise((resolve) => {
    if (!open) {
      // Mounted at the root; if it somehow is not, refuse rather than act unasked.
      resolve(false);
      return;
    }
    open({ ...options, resolve: (value) => resolve(value === true) });
  });
}

/** Ask for one line of text — a reason, a name. A drop-in for `window.prompt`. */
export function promptAction(
  options: Omit<ConfirmOptions, "input" | "typeToConfirm"> & {
    input: NonNullable<ConfirmOptions["input"]>;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!open) {
      resolve(null);
      return;
    }
    open({
      ...options,
      resolve: (value) => resolve(typeof value === "string" ? value : null),
    });
  });
}

/** Mounted once at the root: renders whatever confirmAction() asks. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const settled = useRef(false);

  useEffect(() => {
    open = (request) => {
      settled.current = false;
      setTyped(request.input?.defaultValue ?? "");
      setPending(request);
    };
    return () => {
      open = null;
    };
  }, []);

  function finish(ok: boolean) {
    if (!pending || settled.current) return;
    settled.current = true;
    pending.resolve(pending.input ? (ok ? typed : null) : ok);
    setPending(null);
  }

  const needsName = pending?.typeToConfirm;
  const asks = pending?.input;
  const ready = needsName ? typed.trim() === needsName : true;

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
      size="sm"
      title={pending?.title ?? ""}
      description={pending?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            {pending?.cancelLabel ?? t("Cancel")}
          </Button>
          <Button
            variant={pending?.danger ? "danger-solid" : "primary"}
            disabled={!ready}
            onClick={() => finish(true)}
            // Enter confirms only once the name matches: typing it is the point.
            autoFocus={!needsName && !asks}
          >
            {pending?.confirmLabel ?? t("Confirm")}
          </Button>
        </>
      }
    >
      {asks ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(true);
          }}
        >
          <label
            htmlFor="confirm-input"
            className="flex flex-col gap-1.5 text-sm font-medium text-fg"
          >
            {asks.label}
            <Input
              id="confirm-input"
              autoFocus
              value={typed}
              placeholder={asks.placeholder}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        </form>
      ) : needsName ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) finish(true);
          }}
        >
          <label
            htmlFor="confirm-typed-name"
            className="flex flex-col gap-1.5 text-sm text-fg-secondary"
          >
            <span>
              {t("Type {strong} to confirm.", {
                strong: <strong className="font-mono text-fg">{needsName}</strong>,
              })}
            </span>
            <Input
              id="confirm-typed-name"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </form>
      ) : undefined}
    </Dialog>
  );
}

/** Toasts: the result of an action, said once, then gone. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      containerAriaLabel={t("Notifications")}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-border-default !bg-overlay !text-fg !shadow-overlay !font-sans !text-sm",
          description: "!text-fg-secondary",
          actionButton: "!bg-primary !text-primary-fg",
        },
      }}
    />
  );
}

export { toast };
