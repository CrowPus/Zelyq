import { Eye, EyeOff } from "lucide-react";
import {
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
  useState,
} from "react";

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

/**
 * A password field with a reveal toggle.
 *
 * Typing a long passphrase blind is where people give up and pick something
 * short instead, so the toggle is a security feature rather than a convenience.
 * It stays keyboard reachable, and announces its state, because someone using a
 * screen reader has more reason than anyone to check what was typed.
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
          className={`${BASE} h-[30px] pr-9 pl-2.5 text-sm ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
          className="absolute top-0 right-0 grid h-[30px] w-9 place-items-center rounded-r-md text-fg-muted transition-colors hover:text-fg"
        >
          {visible ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        </button>
        <span id={describedBy} className="sr-only">
          {visible ? "Password is visible" : "Password is hidden"}
        </span>
      </div>
    );
  },
);
