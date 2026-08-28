/**
 * Element inspector. Click something in the preview, the agent finds out
 * what you clicked.
 *
 * Message-type strings shared with the bridge script injected into
 * `templates/vite-react/index.html`. Not imported by that file — it's
 * plain HTML/JS with no build step of its own — so these three constants
 * must be kept in sync by hand if either side changes.
 */
export const INSPECTOR_ACTIVATE = "zelyq:inspector:activate";
export const INSPECTOR_DEACTIVATE = "zelyq:inspector:deactivate";
export const INSPECTOR_SELECTED = "zelyq:inspector:selected";

export interface SelectedElement {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
}

/**
 * True when `data` is a well-formed "an element was selected" message.
 * Anything else — a different message type, a malformed shape — is never
 * acted on. Callers are still responsible for checking `event.source`
 * against the actual preview iframe before trusting this at all; this only
 * validates shape, not origin.
 */
export function isSelectedElementMessage(
  data: unknown,
): data is { type: typeof INSPECTOR_SELECTED; element: SelectedElement } {
  if (!data || typeof data !== "object") return false;
  const message = data as Record<string, unknown>;
  if (message.type !== INSPECTOR_SELECTED) return false;
  const element = message.element;
  if (!element || typeof element !== "object") return false;
  const candidate = element as Record<string, unknown>;
  if (typeof candidate.tag !== "string" || !candidate.tag) return false;
  if (!Array.isArray(candidate.classes)) return false;
  return candidate.classes.every((value) => typeof value === "string");
}

/**
 * Renders a selected element the way a person would describe what they
 * clicked — `<button class="btn-primary">Submit</button>` — not a raw
 * data dump.
 */
export function describeElement(element: SelectedElement): string {
  const attrs = [
    element.id ? `id="${element.id}"` : null,
    element.classes.length ? `class="${element.classes.join(" ")}"` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const open = attrs ? `<${element.tag} ${attrs}>` : `<${element.tag}>`;
  // An empty element (an <input>, an icon with no text) reads oddly with a
  // fake closing tag — <input class="field"></input> isn't even valid HTML,
  // since input is a void element. Closing only makes sense once there's
  // something between the tags.
  return element.text ? `${open}${element.text}</${element.tag}>` : open;
}

/**
 * Woven into the prompt text ahead of what was typed. No protocol change —
 * this is plain text destined for the exact same field `chat.send()`
 * already carries; nothing downstream of the composer needs to know this
 * feature exists.
 */
export function withPointedElement(message: string, element: SelectedElement): string {
  const line = `Regarding ${describeElement(element)} in the preview:`;
  return message.trim() ? `${line}\n${message}` : line;
}
