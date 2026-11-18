import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { Tooltip } from "./Tooltip.js";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-solid"
  | "strong";
export type ButtonSize = "sm" | "md" | "lg";

/*
 * Three heights on the 4px grid: `sm` (24) for toolbars and table rows, `md`
 * (32) for everything else, `lg` (40) for sign-in and first-run screens only.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 gap-1.5 px-2 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
  lg: "h-10 gap-2 px-4 text-base",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
  secondary:
    "bg-surface text-fg border border-border-strong hover:bg-surface-hover hover:border-border-control",
  ghost:
    "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-hover hover:text-fg",
  danger: "bg-transparent text-danger border border-transparent hover:bg-danger-subtle",
  "danger-solid": "bg-danger text-canvas border border-transparent hover:brightness-110",
  strong: "bg-strong text-strong-fg hover:bg-strong-hover border border-transparent",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a spinner in place of the icon and blocks clicks, keeping the width. */
  loading?: boolean;
}

/** A button's look, for a link that has to act as one (a download, a new tab). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-[background-color,border-color,color] duration-100 disabled:pointer-events-none disabled:opacity-45 ${SIZES[size]} ${VARIANTS[variant]}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    loading = false,
    className = "",
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${buttonClass(variant, size)} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <ButtonSpinner /> : icon}
      {children}
    </button>
  );
});

function ButtonSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-80"
    />
  );
}

/**
 * Square button for a lone icon. Always named, always with a real tooltip:
 * an icon nobody can identify is not a control.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "icon"> & { label: string; tooltip?: boolean; shortcut?: string }
>(function IconButton(
  {
    variant = "ghost",
    size = "md",
    label,
    tooltip = true,
    shortcut,
    className = "",
    children,
    type = "button",
    loading: _loading,
    ...props
  },
  ref,
) {
  const box = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8";
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 ${box} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
});

/**
 * A button with no look of its own, for a whole card, row or tile that acts
 * as one: the semantics and focus ring of a button, the styling of its
 * contents. Use `Button` for anything that should look like a button.
 */
export const Pressable = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function Pressable({ type = "button", className = "", ...props }, ref) {
    return (
      <button
        ref={ref}
        // biome-ignore lint/a11y/useButtonType: the default is set above.
        type={type}
        className={`cursor-pointer text-left disabled:cursor-default ${className}`}
        {...props}
      />
    );
  },
);
