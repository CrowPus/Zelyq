import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

export interface ModelChoice {
  provider: string;
  label: string;
}

interface Props {
  /** Null means "the instance default" — nothing is sent with the next prompt. */
  value: ModelChoice | null;
  onChange(value: ModelChoice | null): void;
}

/**
 * A per-conversation model switch, styled after Copilot's own `/model` picker
 * — see `033`. Lists only providers this instance can actually use: a key
 * that isn't configured would just fail on the first prompt, so it isn't
 * offered at all. `custom` is deliberately absent — it names an operator's
 * own endpoint and model, not a vendor with a catalog to pick a tier from,
 * so it doesn't fit this picker's shape.
 */
export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
    staleTime: 60_000,
  });

  const options = (providers.data?.providers ?? []).filter(
    (provider) => provider.configured && provider.id !== "custom",
  );

  // Nothing to switch to — most instances run one configured provider, and a
  // picker with a single, already-active choice in it is just noise.
  if (options.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose a model for this conversation"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <span className="max-w-[10rem] truncate">{value?.label ?? "Default"}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-20 mb-1.5 w-56 rounded-lg border border-border-default bg-overlay p-1 shadow-overlay"
          >
            <MenuRow
              label="Default"
              detail={
                providers.data
                  ? `Currently ${labelFor(providers.data, providers.data.default)}`
                  : undefined
              }
              selected={value === null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            />
            <div className="my-1 border-t border-border-default" />
            {options.map((provider) => (
              <MenuRow
                key={provider.id}
                label={provider.label}
                detail={provider.defaultModel || undefined}
                selected={value?.provider === provider.id}
                onClick={() => {
                  onChange({ provider: provider.id, label: provider.label });
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function labelFor(
  providers: { providers: Array<{ id: string; label: string }> },
  id: string,
): string {
  return providers.providers.find((provider) => provider.id === id)?.label ?? id;
}

function MenuRow({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-fg">{label}</span>
        {detail && <span className="block truncate text-2xs text-fg-muted">{detail}</span>}
      </span>
      {selected && <Check size={13} strokeWidth={2} className="shrink-0 text-fg" />}
    </button>
  );
}
