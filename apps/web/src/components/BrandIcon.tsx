import { BRANDS, type Brand } from "./brand-shapes";

export type { Brand };

/**
 * Another product's logo, in the text colour, at the size of a 14 px Lucide icon by default. With
 * `title` it is named for screen readers and on hover (use it when the logo stands alone);
 * without, it is decoration beside the product's written name.
 */
export function BrandIcon({
  brand,
  size = 14,
  title,
  className = "",
}: {
  brand: Brand;
  size?: number;
  /** Shown on hover and read aloud: for a logo with no name written beside it. */
  title?: string | true;
  className?: string;
}) {
  const shape = BRANDS[brand];
  const label = title === true ? shape.title : title;
  return (
    <svg
      viewBox={shape.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {label && <title>{label}</title>}
      {shape.paths.map((path) => (
        <path
          key={path.d.slice(0, 32)}
          d={path.d}
          fillRule={"evenodd" in path ? "evenodd" : undefined}
        />
      ))}
    </svg>
  );
}

/** The logo for an operating system Zelyq reports ("linux", "macos", "windows"), if there is one. */
export function osBrand(os: string | null | undefined): Brand | null {
  if (os === "linux") return "linux";
  if (os === "macos") return "apple";
  if (os === "windows") return "windows";
  return null;
}

/** The logo for an AI provider id, or a model-picker group label, if there is one. */
export function providerBrand(provider: string | null | undefined): Brand | null {
  const key = (provider ?? "").toLowerCase();
  if (key === "anthropic" || key.startsWith("claude")) return "claude";
  if (key === "openai" || key.startsWith("openai") || key.startsWith("chatgpt")) return "openai";
  if (key === "google" || key.startsWith("gemini") || key.startsWith("google")) return "gemini";
  if (key === "xai" || key.startsWith("grok") || key.startsWith("xai")) return "xai";
  if (key.startsWith("deepseek")) return "deepseek";
  if (key.startsWith("mistral")) return "mistral";
  if (key.startsWith("groq")) return "groq";
  if (key.startsWith("openrouter")) return "openrouter";
  return null;
}

/** The logo for a browser named in a device list ("Chrome on macOS"), if there is one. */
export function browserBrand(name: string | null | undefined): Brand | null {
  const key = (name ?? "").toLowerCase();
  if (key.includes("firefox")) return "firefox";
  if (key.includes("opera")) return "opera";
  if (key.includes("brave")) return "brave";
  if (key.includes("edge")) return null;
  if (key.includes("chrome") || key.includes("chromium")) return "chrome";
  if (key.includes("safari")) return "safari";
  return null;
}

/** A provider's logo, beside its name; nothing for a provider without one (a custom endpoint). */
export function ProviderMark({ provider, size = 14 }: { provider: string; size?: number }) {
  const brand = providerBrand(provider);
  return brand ? <BrandIcon brand={brand} size={size} /> : null;
}
