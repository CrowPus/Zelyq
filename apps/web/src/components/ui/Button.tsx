import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

/*
 * Three sizes would be two too many. `sm` (24px) sits in toolbars and table
 * rows; `md` (30px) is everything else. Both are deliberately shorter than the
 * 40px default that makes an interface feel like a landing page.
 */
const SIZES: Record<Size, string> = {
  sm: "h-6 gap-1.5 px-2 text-xs",
  md: "h-[30px] gap-1.5 px-2.5 text-sm",
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent",
  secondary:
    "bg-surface text-fg border border-border-default hover:bg-surface-hover hover:border-border-strong",
  ghost:
    "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-hover hover:text-fg",
  danger: "bg-transparent text-danger border border-transparent hover:bg-danger-subtle",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-75 disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/** Square button for a lone icon. Keeps toolbars on a consistent rhythm. */
export function IconButton({
  variant = "ghost",
  size = "md",
  label,
  className = "",
  children,
  ...props
}: Omit<ButtonProps, "icon"> & { label: string }) {
  const box = size === "sm" ? "size-6" : "size-[30px]";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-75 disabled:pointer-events-none disabled:opacity-40 ${box} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
