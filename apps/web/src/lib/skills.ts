/**
 * The composer's `/` menu — see `044` in the council notes. A pure
 * function so the matching logic is testable without rendering
 * `ChatPanel`: the draft starting with "/" *is* the open state, and a
 * query that matches nothing must leave the draft as ordinary text — a
 * message that genuinely starts with "/" should never be trapped behind
 * a menu with nothing in it.
 */
export function matchSlashSkills(
  draft: string,
  skills: Array<{ name: string; description: string }>,
  alreadySelected: Array<{ name: string }>,
): Array<{ name: string; description: string }> {
  const match = /^\/(\S*)$/.exec(draft);
  if (!match) return [];
  const query = match[1]!.toLowerCase();
  return skills.filter(
    (skill) =>
      skill.name.startsWith(query) &&
      !alreadySelected.some((selected) => selected.name === skill.name),
  );
}
