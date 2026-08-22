import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from "react";

const BASE =
  "w-full rounded-md border border-border-default bg-surface text-fg placeholder:text-fg-muted " +
  "transition-colors duration-75 hover:border-border-strong focus:border-border-strong " +
  "focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return (
      <input ref={ref} className={`${BASE} h-[30px] px-2.5 text-sm ${className}`} {...props} />
    );
  },
);

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${BASE} resize-none px-2.5 py-2 text-sm ${className}`} {...props} />;
}

/** The small uppercase label Supabase-class dashboards use above a value. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
      {children}
    </span>
  );
}
