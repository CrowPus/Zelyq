import type { ModelChoice } from "../components/ModelPicker";

/**
 * The model picked in a project's chat, kept in this browser so a refresh
 * does not quietly fall back to the team default and send the next message
 * to a different model. Per project and per browser; never shared. Storage
 * can be missing or refuse (private window, blocked site data), so every read
 * and write is guarded and a failure means "Default".
 */
const key = (projectId: string): string => `zelyq.modelChoice.${projectId}`;

export function readModelChoice(projectId: string, storage?: Storage): ModelChoice | null {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelChoice>;
    if (typeof parsed.provider !== "string" || typeof parsed.label !== "string") return null;
    return {
      provider: parsed.provider,
      label: parsed.label,
      ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
    };
  } catch {
    return null;
  }
}

export function writeModelChoice(
  projectId: string,
  choice: ModelChoice | null,
  storage?: Storage,
): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return;
    if (choice) store.setItem(key(projectId), JSON.stringify(choice));
    else store.removeItem(key(projectId));
  } catch {
    // Not remembered; the choice still holds until the page is reloaded.
  }
}
