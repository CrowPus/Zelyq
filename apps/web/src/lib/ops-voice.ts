/**
 * Reading Ops's typed replies aloud with the browser's own voice. Talking to
 * Ops live (it hears you and answers in its own voice) is lib/ops-live.ts.
 */

/**
 * What is read aloud from a reply: its opening sentence (Ops starts every
 * reply with one that sums it up), without the marks Markdown adds.
 */
export function spokenPart(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  const first = plain.split(/\n\s*\n/)[0] ?? plain;
  const sentence = /^[\s\S]*?[.!?](\s|$)/.exec(first)?.[0] ?? first;
  return sentence.trim().slice(0, 400);
}

/** Says something with the browser's own voice; calls back when done (or at once when it cannot). */
export function speak(text: string, onEnd?: () => void): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
