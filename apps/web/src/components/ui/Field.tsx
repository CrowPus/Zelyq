import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check, ChevronDown, Eye, EyeOff, Search, X } from "lucide-react";
import {
  Children,
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from "react";
import { t } from "../../lib/i18n";

/** Control edges use `border-control` (3:1), the one border that has to be seen. */
const BASE =
  "w-full rounded-md border border-border-control bg-surface text-fg placeholder:text-fg-muted " +
  "transition-[border-color,box-shadow] duration-100 hover:border-fg-muted " +
  "focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] focus-visible:outline-none " +
  "aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-50 [&:is(input,textarea):read-only]:bg-surface-subtle";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${BASE} h-8 px-2.5 text-sm ${className}`} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={`${BASE} resize-none px-2.5 py-2 text-sm leading-5 ${className}`}
      {...props}
    />
  );
});

/** The small uppercase label used above a value or a group — never on a control. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
      {children}
    </span>
  );
}

/**
 * A labelled control with help and error text, wired for screen readers: the
 * label names the control, the help and the error describe it.
 */
export function Field({
  label,
  help,
  error,
  required,
  optional,
  children,
  className = "",
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ");
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child, {
        id: (child.props.id as string | undefined) ?? id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })
    : child;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={(isValidElement(child) && (child.props.id as string)) || id}
        className="flex items-baseline gap-1.5 text-sm font-medium text-fg"
      >
        {label}
        {required && (
          <span aria-hidden className="text-danger">
            *
          </span>
        )}
        {optional && <span className="text-xs font-normal text-fg-muted">{t("Optional")}</span>}
      </label>
      {control}
      {help && !error && (
        <p id={helpId} className="text-xs text-fg-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A password field with a reveal toggle. Typing a long passphrase blind is
 * where people give up and pick something short, so the toggle is a security
 * feature rather than a convenience.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className = "", ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const describedBy = useId();
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          aria-describedby={describedBy}
          className={`${BASE} h-8 pr-9 pl-2.5 text-sm ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t("Hide password") : t("Show password")}
          aria-pressed={visible}
          className="absolute top-0 right-0 grid h-8 w-9 place-items-center rounded-r-md text-fg-muted transition-colors hover:text-fg"
        >
          {visible ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        </button>
        <span id={describedBy} className="sr-only">
          {visible ? t("Password is visible") : t("Password is hidden")}
        </span>
      </div>
    );
  },
);

/** A search box with its icon, a clear button and an optional shortcut hint. */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
    value: string;
    onValueChange(value: string): void;
    shortcut?: string;
  }
>(function SearchField({ value, onValueChange, shortcut, className = "", ...props }, ref) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={14}
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={`${BASE} h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden`}
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label={t("Clear search")}
          onClick={() => onValueChange("")}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <X size={12} />
        </button>
      ) : (
        shortcut && (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-sm border border-border-default px-1 text-2xs text-fg-muted">
            {shortcut}
          </kbd>
        )
      )}
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/**
 * The one dropdown. Looks the same on every operating system, unlike the
 * native `<select>`, and keeps its keyboard behaviour.
 */
export const Select = forwardRef<
  HTMLButtonElement,
  {
    value: string | undefined;
    onValueChange(value: string): void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md";
    className?: string;
    id?: string;
    "aria-label"?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }
>(function Select(
  { value, onValueChange, options, placeholder, disabled, size = "md", className = "", ...aria },
  ref,
) {
  // Radix refuses an empty-string value; map it through a sentinel.
  const EMPTY = "__zelyq_empty__";
  return (
    <RadixSelect.Root
      value={value === undefined ? undefined : value === "" ? EMPTY : value}
      onValueChange={(next) => onValueChange(next === EMPTY ? "" : next)}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        ref={ref}
        {...aria}
        className={`${BASE} flex items-center justify-between gap-2 text-left ${
          size === "sm" ? "h-6 px-2 text-xs" : "h-8 px-2.5 text-sm"
        } data-[placeholder]:text-fg-muted ${className}`}
      >
        <span className="min-w-0 truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown size={14} className="shrink-0 text-fg-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-[45] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-default bg-overlay shadow-overlay data-[state=open]:animate-[ui-pop-in_120ms_ease-out]"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value || EMPTY}
                value={option.value === "" ? EMPTY : option.value}
                disabled={option.disabled}
                className="relative flex cursor-default items-start gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm text-fg outline-none select-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-hover"
              >
                <RadixSelect.ItemIndicator className="absolute top-2 left-2">
                  <Check size={13} strokeWidth={2} className="text-accent" />
                </RadixSelect.ItemIndicator>
                <div className="min-w-0">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.description && (
                    <div className="mt-0.5 text-xs text-fg-muted">{option.description}</div>
                  )}
                </div>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
});

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
  /** Accessible name, when no visible label points at it. */
  label?: string;
  id?: string;
}) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-control transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-accent"
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  return (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      aria-label={label}
      className="grid size-4 shrink-0 place-items-center rounded-sm border border-border-control bg-surface transition-colors disabled:opacity-45 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent"
    >
      <RadixCheckbox.Indicator className="text-accent-fg">
        {checked === "indeterminate" ? (
          <span className="block h-0.5 w-2 rounded-full bg-current" />
        ) : (
          <Check size={12} strokeWidth={3} />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

/** Two to five mutually exclusive choices shown side by side. */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  label,
  className = "",
}: {
  value: T;
  onValueChange(value: T): void;
  options: Array<{ value: NoInfer<T>; label: ReactNode; icon?: ReactNode; disabled?: boolean }>;
  size?: "sm" | "md";
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-md border border-border-default bg-surface-subtle p-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled radio group, roles set explicitly.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors disabled:opacity-45 ${
              size === "sm" ? "h-[22px] px-2 text-xs" : "h-7 px-2.5 text-sm"
            } ${
              active
                ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-border-default"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A native `<select>` in the product's styling, for long or dynamic option
 * lists inside forms. Keeps the operating system's own picker on phones and
 * full screen-reader support (the approach GitHub's Primer takes). Use
 * `Select` where options need descriptions.
 */
export const NativeSelect = forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md" }
>(function NativeSelect({ className = "", size = "md", children, ...props }, ref) {
  // Layout classes (width, margins) belong to the box; colour and type to the control.
  const layout = className
    .split(/\s+/)
    .filter((c) =>
      /^(!?(sm:|md:|lg:)?(w-|min-w-|max-w-|flex-|shrink|grow|basis-|m[trblxy]?-|self-|col-span))/.test(
        c,
      ),
    )
    .join(" ");
  const own = className
    .split(/\s+/)
    .filter((c) => c && !layout.split(" ").includes(c))
    .join(" ");
  const inline = /\bw-auto\b/.test(layout);
  return (
    <span className={`relative min-w-0 ${inline ? "inline-flex" : "flex w-full"} ${layout}`}>
      <select
        ref={ref}
        className={`${BASE} appearance-none pr-8 ${size === "sm" ? "h-6 pl-2 text-xs" : "h-8 pl-2.5 text-sm"} ${own}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        size={14}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-muted"
      />
    </span>
  );
});
