import type { Project } from "@zelyq/core";
import { initials } from "./ui";

function hueOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/**
 * An app's picture: the screenshot taken from its running preview when there
 * is one, otherwise a pattern in a colour derived from its name with its
 * initials — so every card is recognisable from the first day.
 */
export function AppCardThumb({
  project,
  height = "aspect-[16/10]",
  stackIcon,
}: {
  project: Pick<Project, "id" | "name" | "thumbnailAt">;
  /** A Tailwind height or aspect class. */
  height?: string;
  stackIcon?: string;
}) {
  if (project.thumbnailAt) {
    return (
      <span className={`relative block overflow-hidden bg-surface-subtle ${height}`}>
        <img
          src={`/api/projects/${project.id}/thumbnail?v=${encodeURIComponent(project.thumbnailAt)}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      </span>
    );
  }
  const hue = hueOf(project.name || project.id);
  return (
    <span
      aria-hidden
      className={`relative flex items-center justify-center overflow-hidden ${height}`}
      style={{
        background: `radial-gradient(circle at 20% 15%, light-dark(oklch(0.93 0.06 ${hue}), oklch(0.32 0.06 ${hue})) 0%, transparent 55%), radial-gradient(circle at 85% 90%, light-dark(oklch(0.9 0.07 ${(hue + 40) % 360}), oklch(0.3 0.07 ${(hue + 40) % 360})) 0%, transparent 50%), light-dark(oklch(0.97 0.015 ${hue}), oklch(0.22 0.02 ${hue}))`,
      }}
    >
      <span
        className="absolute inset-0 opacity-40 [background-image:radial-gradient(oklch(0.6_0.05_var(--hue))_0.75px,transparent_0.75px)] [background-size:12px_12px]"
        style={{ ["--hue" as string]: String(hue) }}
      />
      <span
        className="relative grid size-11 place-items-center rounded-lg text-base font-semibold shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
        style={{
          background: `light-dark(oklch(0.99 0.01 ${hue}), oklch(0.27 0.03 ${hue}))`,
          color: `light-dark(oklch(0.42 0.12 ${hue}), oklch(0.85 0.09 ${hue}))`,
        }}
      >
        {initials(project.name).slice(0, 2)}
      </span>
      {stackIcon && (
        <img
          src={`/${stackIcon}`}
          alt=""
          width={18}
          height={18}
          className="absolute right-2.5 bottom-2.5 size-[18px] object-contain opacity-80"
        />
      )}
    </span>
  );
}
