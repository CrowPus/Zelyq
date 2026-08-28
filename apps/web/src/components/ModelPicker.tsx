import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

export interface ModelChoice {
  provider: string;
  /** Absent means the provider's own default — never guessed here. */
  model?: string;
  /** What the picker's button shows once this is selected. */
  label: string;
}

interface Props {
  /** Null means "the instance default" — nothing is sent with the next prompt. */
  value: ModelChoice | null;
  onChange(value: ModelChoice | null): void;
}

/**
 * A per-conversation model switch, styled after Copilot's own `/model`
 * picker. Picking a *model*, not just a vendor: Claude Opus, Sonnet, and
 * Haiku are three separate rows, not one "Claude" row that quietly always
 * uses whichever one happens to be the default. A provider with nothing
 * confirmed in its model catalog is left out entirely — there is nothing to
 * pick, and offering it anyway would mean guessing a model name the agent
 * would then refuse. `custom` is absent for the same reason: it names an
 * operator's own endpoint, not a vendor with tiers.
 */
export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
    staleTime: 60_000,
  });

  const groups = (providers.data?.providers ?? []).filter(
    (provider) => provider.configured && provider.id !== "custom" && provider.models?.length,
  );

  // Nothing with a real model catalog is configured — most instances run one
  // provider, and a picker with nothing to switch to is just noise.
  if (groups.length === 0) return null;

  return (
    // shrink-0 + a fixed-width trigger: the button row must not move when the
    // model name is long. The name truncates inside a constant box; the full
    // label is on hover and in the menu.
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose a model for this conversation"
        title={value?.label ?? "Default"}
        className="flex w-[7.5rem] items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <span className="min-w-0 flex-1 truncate text-left">{value?.label ?? "Default"}</span>
        <ChevronDown size={11} strokeWidth={2} className="shrink-0" />
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
            className="absolute bottom-full left-0 z-20 mb-1.5 max-h-80 w-64 overflow-y-auto rounded-lg border border-border-default bg-overlay p-1 shadow-overlay"
          >
            <MenuRow
              label="Default"
              detail="Whatever this instance is currently set to"
              selected={value === null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            />
            {groups.map((provider) => (
              <div key={provider.id} className="mt-1 first:mt-0">
                <div className="my-1 border-t border-border-default" />
                <p className="px-2.5 pb-1 text-2xs font-medium tracking-[0.04em] text-fg-muted uppercase">
                  {provider.label}
                </p>
                {provider.models?.map((model) => (
                  <MenuRow
                    key={`${provider.id}:${model.value}`}
                    label={model.label}
                    selected={value?.provider === provider.id && value.model === model.value}
                    onClick={() => {
                      onChange({ provider: provider.id, model: model.value, label: model.label });
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
