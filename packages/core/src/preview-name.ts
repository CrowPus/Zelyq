import type { Project } from "./models.js";

/**
 * The hostname a preview is reached at, when previews are served by name
 * rather than by port.
 *
 * `p4380.preview.example.com` works, and tells a person nothing. A name they
 * chose does: `shop-a1b2c3.example.com`. The tail is six characters of the
 * project's own id, and it is not decoration — without it, every second
 * project on a shared instance is called `todo`, and anybody could read a
 * stranger's half-built app by guessing ordinary words. Six hex characters is
 * sixteen million, which is enough to stop guessing without making the
 * address unreadable.
 *
 * Derived rather than stored, so there is no second source of truth to keep
 * in step and no migration: the same project always resolves to the same
 * name, and renaming a project changes its address (its old one stops
 * working), which is the same bargain every hosting product makes.
 */
export function previewHostLabel(project: Pick<Project, "id" | "slug">): string {
  const tail = project.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toLowerCase();
  const slug = (project.slug || "project")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  return `${slug || "project"}-${tail}`;
}

/** The six-character tail from a hostname label, or null when it is not one
 * of ours. Matching on the tail alone is deliberate: a project renamed after
 * somebody bookmarked the address still resolves. */
export function previewTailFromHost(label: string): string | null {
  const match = /^[a-z0-9-]*-([a-z0-9]{6})$/i.exec(label);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The address to show for a running preview.
 *
 * `{port}` is the long-standing placeholder. `{name}` is the one that needs a
 * project, so it is resolved here rather than in the runtime, which only ever
 * knows a project by its id.
 */
export function previewAddress(
  template: string | undefined,
  project: Pick<Project, "id" | "slug">,
  port: number | null,
): string | null {
  if (!template || port === null) return null;
  if (!template.includes("{name}")) return null;
  return template
    .replaceAll("{name}", previewHostLabel(project))
    .replaceAll("{port}", String(port));
}

/** The domain previews live under, read from the template — the one place a
 * deployment says it. `https://{name}.zelyq.global` ⇒ `.zelyq.global`. */
export function previewDomainSuffix(template: string | undefined): string | null {
  if (!template?.includes("{name}")) return null;
  try {
    const host = new URL(template.replaceAll("{name}", "x").replaceAll("{port}", "1")).hostname;
    const dot = host.indexOf(".");
    return dot === -1 ? null : host.slice(dot);
  } catch {
    return null;
  }
}
