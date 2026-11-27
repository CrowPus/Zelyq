import path from "node:path";

/**
 * A path for names (an owner's or a file's id) under one of Zelyq's own folders, refused if it would
 * lead anywhere else. Ids are checked where they arrive; this makes sure of it where paths are made.
 */
export function within(root: string, ...names: string[]): string {
  const base = path.resolve(root);
  const full = path.resolve(base, ...names);
  if (!full.startsWith(base + path.sep))
    throw new Error(`Not a name inside ${base}: ${names.join("/")}`);
  return full;
}
