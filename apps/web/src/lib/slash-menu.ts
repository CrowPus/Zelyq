/**
 * The composer's `/` menu. A slash command has to work anywhere in the
 * message, not just at the very start of the draft — someone typing
 * "design my website /shadcn" needs the menu to open right where they
 * typed it, not force them to delete back to the start of the line.
 */

export interface SlashCommand {
  /** Text after the "/", up to the cursor — what's being typed to filter. */
  query: string;
  /** Index of the "/" character itself. */
  start: number;
  /** The cursor position this was computed at — where `query` ends. */
  end: number;
}

/**
 * A slash *command* — unlike a skill / model / agent / plugin pick, this one
 * carries an argument and stays in the draft after it's chosen. `insert` is
 * what replaces the `/query` fragment (e.g. `"/clone "`), leaving the cursor
 * after it for the user to type the argument. `clone` is the only one today
 * (proposal 067); the shape is here so a second is cheap.
 */
export interface SlashMenuCommand {
  name: string;
  blurb: string;
  insert: string;
}

export const SLASH_COMMANDS: SlashMenuCommand[] = [
  {
    name: "clone",
    blurb: "Rebuild a live website in this project, page for page — you give it the URL.",
    insert: "/clone ",
  },
  {
    name: "figma",
    blurb: "Build a website from a Figma frame — paste the frame's share link.",
    insert: "/figma ",
  },
];

/**
 * Finds an active slash-command fragment ending at the cursor, if any. The
 * "/" has to start a fresh word — the beginning of the message, or right
 * after whitespace — so "https://example.com" or "a/b" never trigger it;
 * only a space or the start of typing does. Nothing between the "/" and
 * the cursor may contain whitespace — once a space follows, the command is
 * finished (or was never one), and the menu closes.
 */
export function findSlashCommand(text: string, cursor: number): SlashCommand | null {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("/");
  if (start === -1) return null;

  const query = before.slice(start + 1);
  if (/\s/.test(query)) return null;

  const precedingChar = before[start - 1];
  if (precedingChar !== undefined && !/\s/.test(precedingChar)) return null;

  return { query, start, end: cursor };
}

/** Prefix match on whatever each item is labelled by, case-insensitive —
 * the same simple filter every section of the menu uses. */
export function matchByPrefix<T>(items: T[], query: string, label: (item: T) => string): T[] {
  const lower = query.toLowerCase();
  return items.filter((item) => label(item).toLowerCase().startsWith(lower));
}

/**
 * Replaces the `/query` fragment a selection just resolved with `replacement`
 * (empty, for a command that leaves nothing behind once picked) — the text
 * on either side of it is untouched, wherever in the message it was.
 */
export function replaceSlashCommand(text: string, command: SlashCommand, replacement = ""): string {
  return text.slice(0, command.start) + replacement + text.slice(command.end);
}
