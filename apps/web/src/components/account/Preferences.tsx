import { useMutation } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useTheme } from "../../hooks/useTheme";
import { api } from "../../lib/api";
import { Button, Card, Field, NativeSelect, SegmentedControl, toast } from "../ui";

/** Languages offered, each in its own name. */
const LANGUAGES: Array<{ tag: string; name: string }> = [
  { tag: "en-GB", name: "English (United Kingdom)" },
  { tag: "en-US", name: "English (United States)" },
  { tag: "fr-FR", name: "Français" },
  { tag: "de-DE", name: "Deutsch" },
  { tag: "es-ES", name: "Español" },
  { tag: "pt-BR", name: "Português (Brasil)" },
  { tag: "pt-PT", name: "Português (Portugal)" },
  { tag: "it-IT", name: "Italiano" },
  { tag: "nl-NL", name: "Nederlands" },
  { tag: "ar", name: "العربية" },
  { tag: "sw", name: "Kiswahili" },
  { tag: "ja-JP", name: "日本語" },
  { tag: "zh-CN", name: "中文（简体）" },
];

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** Language, time zone and theme: how this account sees Zelyq on any device. */
export function PreferencesCard() {
  const { user, refresh } = useSession();
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useState(user?.locale ?? "");
  const [timeZone, setTimeZone] = useState(user?.timeZone ?? "");
  useEffect(() => {
    setLocale(user?.locale ?? "");
    setTimeZone(user?.timeZone ?? "");
  }, [user?.locale, user?.timeZone]);

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const browserLocale = navigator.language;
  const zones = useMemo(timeZones, []);
  const dirty = locale !== (user?.locale ?? "") || timeZone !== (user?.timeZone ?? "");

  const save = useMutation({
    mutationFn: () => api.setPreferences({ locale: locale || null, timeZone: timeZone || null }),
    onSuccess: () => {
      toast.success("Preferences saved");
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  // What a date will look like with the choices as they stand, before saving.
  const example = new Intl.DateTimeFormat(locale || browserLocale, {
    dateStyle: "full",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date());

  return (
    <Card
      title="Language and region"
      description="How dates, times and numbers are written for you, on every device you sign in on."
      footer={
        <>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setLocale(user?.locale ?? "");
                setTimeZone(user?.timeZone ?? "");
              }}
            >
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Language"
          help="Zelyq's own words are in English for now; this sets how dates and numbers are written."
        >
          <NativeSelect value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="">Same as this browser ({browserLocale})</option>
            {LANGUAGES.map((language) => (
              <option key={language.tag} value={language.tag}>
                {language.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Time zone">
          <NativeSelect value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
            <option value="">Same as this device ({browserZone})</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">
          Dates will look like: <span className="font-medium text-fg">{example}</span>
        </p>
      </div>
      <div className="mt-6 border-t border-border-default pt-4">
        <p className="mb-2 text-sm font-medium text-fg">Theme</p>
        <SegmentedControl
          label="Theme"
          value={theme}
          onValueChange={(next) => setTheme(next as typeof theme)}
          options={[
            { value: "light", label: "Light", icon: <Sun size={14} /> },
            { value: "dark", label: "Dark", icon: <Moon size={14} /> },
            { value: "system", label: "Match system", icon: <Monitor size={14} /> },
          ]}
        />
        <p className="mt-2 text-xs text-fg-muted">The theme is kept on this device only.</p>
      </div>
    </Card>
  );
}
