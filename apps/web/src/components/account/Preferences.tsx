import { useMutation } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBackgroundTexture } from "../../hooks/useBackgroundTexture";
import { useSession } from "../../hooks/useSession";
import { useTheme } from "../../hooks/useTheme";
import { api } from "../../lib/api";
import { currentLanguage, languageOf, switchLanguage, t } from "../../lib/i18n";
import { Button, Card, Field, NativeSelect, SegmentedControl, Switch, toast } from "../ui";

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
  { tag: "zh-CN", name: "简体中文" },
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
  const texture = useBackgroundTexture();
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
      toast.success(t("Preferences saved"));
      refresh();
      // Zelyq's own words follow too, when it speaks the chosen language;
      // "same as this browser" follows the browser's.
      const wanted = languageOf(locale || browserLocale) ?? "en";
      if (wanted !== currentLanguage()) switchLanguage(wanted);
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
      title={t("Language and region")}
      description={t(
        "How dates, times and numbers are written for you, on every device you sign in on.",
      )}
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
              {t("Discard")}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("Language")}
          help={t(
            "Zelyq is in English, French, German, Spanish, Portuguese and Chinese. Other languages set how dates and numbers are written; the screens stay in English.",
          )}
        >
          <NativeSelect value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="">
              {t("Same as this browser ({browserLocale})", { browserLocale })}
            </option>
            {LANGUAGES.map((language) => (
              <option key={language.tag} value={language.tag}>
                {language.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("Time zone")}>
          <NativeSelect value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
            <option value="">{t("Same as this device ({browserZone})", { browserZone })}</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">
          {t("Dates will look like: {example}", {
            example: <span className="font-medium text-fg">{example}</span>,
          })}
        </p>
      </div>
      <div className="mt-6 border-t border-border-default pt-4">
        <p className="mb-2 text-sm font-medium text-fg">{t("Theme")}</p>
        <SegmentedControl
          label={t("Theme")}
          value={theme}
          onValueChange={(next) => setTheme(next as typeof theme)}
          options={[
            { value: "light", label: t("Light"), icon: <Sun size={14} /> },
            { value: "dark", label: t("Dark"), icon: <Moon size={14} /> },
            { value: "system", label: t("Match system"), icon: <Monitor size={14} /> },
          ]}
        />
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <label htmlFor="background-texture" className="text-sm font-medium text-fg">
              {t("Background texture")}
            </label>
            <p className="mt-0.5 text-xs text-fg-muted">
              {t(
                "A faint moving pattern behind the pages. It holds still if your device asks for less motion.",
              )}
            </p>
          </div>
          <Switch id="background-texture" checked={texture.on} onCheckedChange={texture.setOn} />
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {t("The theme and texture are kept on this device only.")}
        </p>
      </div>
    </Card>
  );
}
