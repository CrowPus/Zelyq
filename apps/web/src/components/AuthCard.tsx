import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

/** The narrow centred card every signed-out screen uses: sign in, reset, invitation. */
export function AuthCard(props: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-8">
      <div className="w-full max-w-[340px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <img src="/zelyq-mark-64.png" alt="" width={32} height={32} className="size-8" />
          <div>
            <h1 className="text-lg font-semibold text-fg">{props.title}</h1>
            {props.subtitle && <p className="mt-1 text-xs text-fg-secondary">{props.subtitle}</p>}
          </div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function AuthError(props: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger"
    >
      <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

export function AuthNotice(props: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-success/25 bg-success-subtle px-2.5 py-2 text-xs text-success"
    >
      <CircleCheck size={14} strokeWidth={1.75} className="mt-px shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}
