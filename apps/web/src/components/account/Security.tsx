import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SignedInSession } from "@zelyq/core";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  LogOut,
  Monitor,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { type Brand, BrandIcon, browserBrand } from "../BrandIcon";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  confirmAction,
  Dialog,
  Field,
  InlineAlert,
  Input,
  PasswordInput,
  RelativeTime,
  Skeleton,
  toast,
} from "../ui";

/* ------------------------------------------------------------------------ */
/* Two-factor sign-in                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Two-factor sign-in with an authenticator app: off or on, how many recovery
 * codes are left, and the ways to turn it on, renew the codes or turn it off.
 */
export function TwoFactorCard() {
  const status = useQuery({ queryKey: ["two-factor"], queryFn: api.twoFactor.status });
  const [dialog, setDialog] = useState<"setup" | "disable" | "codes" | null>(null);
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const after = async () => {
    await queryClient.invalidateQueries({ queryKey: ["two-factor"] });
    refresh();
  };

  const enabled = status.data?.enabled ?? false;
  const left = status.data?.recoveryCodesLeft ?? 0;

  return (
    <Card
      title={t("Two-factor sign-in")}
      description={t(
        "After your password, Zelyq also asks for a code from an authenticator app on your phone, such as 1Password, Google Authenticator or Microsoft Authenticator.",
      )}
      actions={
        status.isLoading ? null : enabled ? (
          <Badge tone="success">{t("On")}</Badge>
        ) : (
          <Badge tone="neutral">{t("Off")}</Badge>
        )
      }
    >
      {status.isLoading ? (
        <Skeleton className="h-8 w-40" />
      ) : enabled ? (
        <div className="flex flex-col gap-4">
          {left <= 3 && (
            <InlineAlert
              tone="warning"
              title={
                left === 0
                  ? t("No recovery codes left")
                  : t("Only {left} recovery codes left", { left })
              }
            >
              {t("Make new ones, so you can still sign in if you lose your phone.")}
            </InlineAlert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-fg-secondary">
              <ShieldCheck size={15} className="mr-1.5 inline text-success" />
              {t("Signing in asks for a code. {left} of 10 recovery codes left.", { left })}
            </p>
            <Button icon={<KeyRound size={14} />} onClick={() => setDialog("codes")}>
              {t("New recovery codes")}
            </Button>
            <Button
              variant="danger"
              icon={<ShieldOff size={14} />}
              onClick={() => setDialog("disable")}
            >
              {t("Turn off")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg-secondary">
            {t("Someone who learns your password still cannot sign in without your phone.")}
          </p>
          <Button
            variant="primary"
            icon={<ShieldCheck size={14} />}
            onClick={() => setDialog("setup")}
          >
            {t("Turn on")}
          </Button>
        </div>
      )}

      <SetupDialog
        open={dialog === "setup"}
        onOpenChange={(open) => setDialog(open ? "setup" : null)}
        onDone={after}
      />
      <ConfirmCodeDialog
        open={dialog === "disable"}
        onOpenChange={(open) => setDialog(open ? "disable" : null)}
        title={t("Turn off two-factor sign-in?")}
        description={t("Signing in will ask only for your password again.")}
        confirmLabel={t("Turn off")}
        danger
        run={async (input) => {
          await api.twoFactor.disable(input);
          toast.success(t("Two-factor sign-in is off"));
          await after();
          return null;
        }}
      />
      <ConfirmCodeDialog
        open={dialog === "codes"}
        onOpenChange={(open) => setDialog(open ? "codes" : null)}
        title={t("Make new recovery codes?")}
        description={t("Your old recovery codes stop working.")}
        confirmLabel={t("Make new codes")}
        run={async (input) => {
          const { recoveryCodes } = await api.twoFactor.recoveryCodes(input);
          await after();
          return recoveryCodes;
        }}
      />
    </Card>
  );
}

/** Password, then the QR code and the first code, then the recovery codes. */
function SetupDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void | Promise<void>;
}) {
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("password");
      setPassword("");
      setCode("");
      setSecret(null);
      setQr(null);
      setCodes([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!secret) return;
    void QRCode.toDataURL(secret.otpauthUri, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setQr(null));
  }, [secret]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "password") {
        setSecret(await api.twoFactor.setup(password));
        setPassword("");
        setStep("scan");
      } else if (step === "scan") {
        const result = await api.twoFactor.enable(code);
        setCodes(result.recoveryCodes);
        setStep("codes");
        await onDone();
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Once on, closing is only by the Done button: the codes must be seen.
        if (!next && step === "codes") return;
        onOpenChange(next);
      }}
      size="md"
      title={
        step === "password"
          ? t("Turn on two-factor sign-in")
          : step === "scan"
            ? t("Scan the code with your app")
            : t("Save your recovery codes")
      }
      description={
        step === "password"
          ? t("Step 1 of 3 · Confirm it is you.")
          : step === "scan"
            ? t("Step 2 of 3 · Add Zelyq to your authenticator app.")
            : t("Step 3 of 3 · Two-factor sign-in is on.")
      }
      footer={
        step === "codes" ? null : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={step === "password" ? !password : code.length !== 6}
              onClick={() => void submit()}
            >
              {step === "password" ? t("Continue") : t("Turn on")}
            </Button>
          </>
        )
      }
    >
      {step === "password" && (
        <form onSubmit={submit}>
          <Field label={t("Your password")} error={error}>
            <PasswordInput
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
        </form>
      )}
      {step === "scan" && secret && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="grid size-[172px] shrink-0 place-items-center rounded-lg border border-border-default bg-white p-2">
              {qr ? (
                <img
                  src={qr}
                  alt={t("QR code to add Zelyq to an authenticator app")}
                  className="size-40"
                />
              ) : (
                <Skeleton className="size-40" />
              )}
            </div>
            <div className="min-w-0 text-sm text-fg-secondary">
              <p>
                {t(
                  "In your authenticator app, add an account and scan this code. If you cannot scan, type this key instead:",
                )}
              </p>
              <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 rounded-md bg-surface-subtle px-2.5 py-2 font-mono text-xs text-fg">
                {secret.secret.match(/.{1,4}/g)?.map((group, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: groups of a key can repeat.
                  <span key={i} className="whitespace-nowrap">
                    {group}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <Field label={t("The 6-digit code your app shows")} error={error}>
            <Input
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="font-mono tracking-[0.2em]"
            />
          </Field>
        </form>
      )}
      {step === "codes" && <RecoveryCodes codes={codes} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

/** Shows new recovery codes once, with copy and download, and asks that they were saved. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone(): void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = t("Zelyq recovery codes — each works once.\n\n{codes}\n", {
    codes: codes.join("\n"),
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-secondary">
        {t(
          "If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, such as a password manager. They are shown only now.",
        )}
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border-default bg-surface-subtle p-4 font-mono text-sm text-fg">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? t("Copied") : t("Copy all")}
        </Button>
        <Button
          icon={<Download size={14} />}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "zelyq-recovery-codes.txt";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t("Download")}
        </Button>
      </div>
      <span className="flex items-center gap-2 text-sm text-fg">
        <Checkbox id="codes-saved" checked={saved} onCheckedChange={setSaved} />
        <label htmlFor="codes-saved">{t("I have saved these codes")}</label>
      </span>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {t("Done")}
        </Button>
      </div>
    </div>
  );
}

/** Asks for the password and a code, then runs; shows new recovery codes if it returns some. */
function ConfirmCodeDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  run,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run(input: { password: string; code: string }): Promise<string[] | null>;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setCode("");
      setError(null);
      setCodes(null);
    }
  }, [open]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await run({ password, code });
      if (result) setCodes(result);
      else onOpenChange(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && codes) return;
        onOpenChange(next);
      }}
      size="sm"
      title={codes ? t("Your new recovery codes") : title}
      description={codes ? undefined : description}
      footer={
        codes ? null : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button
              variant={danger ? "danger-solid" : "primary"}
              loading={busy}
              disabled={!password || code.length < 6}
              onClick={() => void submit()}
            >
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => onOpenChange(false)} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t("Your password")}>
            <PasswordInput
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label={t("A code from your app, or a recovery code")} error={error}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              className="font-mono"
            />
          </Field>
          <Button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Signed-in devices                                                        */
/* ------------------------------------------------------------------------ */

/** "Chrome on macOS", from a user-agent string, in plain words. */
export function describeDevice(userAgent: string | null): {
  name: string;
  phone: boolean;
  /** The browser's logo and the system's, when Zelyq has them. */
  browserLogo: Brand | null;
  systemLogo: Brand | null;
} {
  if (!userAgent)
    return { name: t("Unknown browser"), phone: false, browserLogo: null, systemLogo: null };
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? t("Edge")
    : /OPR\/|Opera/.test(ua)
      ? t("Opera")
      : /Firefox\//.test(ua)
        ? t("Firefox")
        : /Chrome\//.test(ua)
          ? t("Chrome")
          : /Safari\//.test(ua)
            ? t("Safari")
            : /curl|python|node|Go-http/i.test(ua)
              ? t("A script")
              : t("A browser");
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? t("Android")
      : /Windows/.test(ua)
        ? t("Windows")
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? t("Linux")
              : null;
  return {
    name: os ? `${browser} on ${os}` : browser,
    phone: /iPhone|Android.+Mobile|Mobile Safari/.test(ua),
    browserLogo: /Edg\//.test(ua)
      ? null
      : /OPR\/|Opera/.test(ua)
        ? "opera"
        : browserBrand(ua.replace("CriOS", "Chrome")),
    systemLogo: /iPhone|iPad|Mac OS X|Macintosh/.test(ua)
      ? "apple"
      : /Android|CrOS/.test(ua)
        ? null
        : /Windows/.test(ua)
          ? "windows"
          : /Linux/.test(ua)
            ? "linux"
            : null,
  };
}

/** Every browser or device signed in to this account, and a way to sign each out. */
export function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ["signed-in-sessions"],
    queryFn: api.signedInSessions.list,
  });
  const end = useMutation({
    mutationFn: (id: string) => api.signedInSessions.end(id),
    onSuccess: async () => {
      toast.success(t("That device is signed out"));
      await queryClient.invalidateQueries({ queryKey: ["signed-in-sessions"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  // This device first, then the rest by when they were last used.
  const list: SignedInSession[] = [...(sessions.data?.sessions ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current),
  );
  const others = list.filter((session) => !session.current).length;

  async function endOthers() {
    const ok = await confirmAction({
      title: t("Sign out of every other device?"),
      description: t(
        "{others} other {others, plural, one {device is} other {devices are}} signed out at once. This one stays signed in.",
        { others },
      ),
      confirmLabel: t("Sign out others"),
      danger: true,
    });
    if (!ok) return;
    try {
      const { ended } = await api.signedInSessions.endOthers();
      toast.success(t("{ended, plural, one {# device} other {# devices}} signed out", { ended }));
      await queryClient.invalidateQueries({ queryKey: ["signed-in-sessions"] });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Card
      title={t("Signed-in devices")}
      description={t(
        "Everywhere this account is signed in now. Sign out any you do not recognise, then change your password.",
      )}
      actions={
        others > 0 && (
          <Button size="sm" variant="danger" icon={<LogOut size={13} />} onClick={endOthers}>
            {t("Sign out others")}
          </Button>
        )
      }
      padded={false}
    >
      {sessions.isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <ul className="divide-y divide-border-default">
          {list.map((session) => {
            const device = describeDevice(session.userAgent);
            return (
              <li key={session.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border-default text-fg-muted">
                  {device.browserLogo ? (
                    <BrandIcon brand={device.browserLogo} size={16} />
                  ) : device.phone ? (
                    <Smartphone size={16} />
                  ) : (
                    <Monitor size={16} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                    {device.name}
                    {device.systemLogo && (
                      <span className="inline-flex text-fg-muted">
                        <BrandIcon brand={device.systemLogo} size={12} />
                      </span>
                    )}
                    {session.current && <Badge tone="accent">{t("This device")}</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {session.ip ? `${session.ip} · ` : ""}
                    {session.current
                      ? t("Active now")
                      : t("Last active {when}", {
                          when: <RelativeTime value={session.lastSeenAt} />,
                        })}
                    {t(" · signed in {when}", { when: <RelativeTime value={session.createdAt} /> })}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    size="sm"
                    loading={end.isPending && end.variables === session.id}
                    onClick={() => end.mutate(session.id)}
                  >
                    {t("Sign out")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
