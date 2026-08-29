/**
 * When an assistant message ends by asking the user to send a specific word to
 * carry on ("Reply with **continue** to proceed…"), the chat shows a button
 * that sends that word — instead of making the user type it. Copilot-style.
 *
 * Pure and forgiving: it looks at the tail of the message (the ask is always
 * near the end), pulls the word out of the common phrasings, and returns it —
 * or `null` when there is no such ask.
 */

const ACCEPTED = [
  "continue",
  "go on",
  "go ahead",
  "keep going",
  "carry on",
  "proceed",
  "next",
  "yes",
  "build it",
  "do it",
];

// "reply|respond|answer|type|send|say"  ["]word["]  ["to"] "continue|proceed|…"
const PATTERNS: RegExp[] = [
  /\b(?:reply|respond|answer|type|send|say|hit)\s+(?:with\s+|back\s+with\s+)?[*_"'“”`]{0,3}([A-Za-z][A-Za-z .'-]{0,22}?)[*_"'“”`]{0,3}\s+(?:to\s+|and\s+I['’]?ll\s+|when\s+(?:you['’]?re\s+)?ready\s+to\s+)?(?:continue|proceed|carry on|keep going|move on|resume|go on|for the next|to get the next)/i,
  /\b[*_"'“”`]{1,2}([A-Za-z][A-Za-z .'-]{0,22}?)[*_"'“”`]{1,2}\s+to (?:continue|proceed|get the next|move on)\b/i,
];

export function detectContinuePrompt(messageText: string | null | undefined): string | null {
  if (!messageText) return null;
  const tail = messageText.slice(-600);
  for (const pattern of PATTERNS) {
    const match = tail.match(pattern);
    const raw = match?.[1]
      ?.trim()
      .replace(/[*_"'“”`]/g, "")
      .toLowerCase();
    if (raw && ACCEPTED.includes(raw)) return raw;
  }
  return null;
}

/** The button caption for a detected word. */
export function continueLabel(word: string): string {
  if (word === "continue" || word === "proceed" || word === "next") return "Continue";
  return word.replace(/\b\w/g, (c) => c.toUpperCase());
}
