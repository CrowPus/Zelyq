import { isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";

/**
 * Edits a pipeline file the way the visual editor needs, without losing what
 * it does not show: every change goes through the YAML document, so comments,
 * key order and keys the editor knows nothing about stay exactly as written.
 * Each function takes the file's text and returns the new text; a file that
 * is not valid YAML comes back unchanged.
 */

export type DocPath = (string | number)[];

function open(source: string) {
  const doc = parseDocument(source, { keepSourceTokens: false });
  return doc.errors.length > 0 ? null : doc;
}

/** The text again, in the file's compact style: {a: 1}, long lines left whole. */
function write(doc: NonNullable<ReturnType<typeof open>>): string {
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
}

/** Whether the visual editor can work on this text. */
export function editable(source: string): boolean {
  const doc = open(source);
  return doc !== null && isMap(doc.contents);
}

/** The file as plain values, for showing. */
export function readFile(source: string): Record<string, unknown> | null {
  const doc = open(source);
  if (!doc) return null;
  const value = doc.toJS() as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0)
  );
}

/** Sets a value; an empty one (undefined, "", [], {}) removes the key instead. */
export function setIn(source: string, path: DocPath, value: unknown): string {
  const doc = open(source);
  if (!doc) return source;
  if (empty(value)) {
    if (!doc.hasIn(path)) return source;
    doc.deleteIn(path);
  } else {
    doc.setIn(path, doc.createNode(value));
  }
  return write(doc);
}

/** Inserts an item into the list at `path`, at `index` (the end when past it). */
export function insertIn(source: string, path: DocPath, index: number, value: unknown): string {
  const doc = open(source);
  if (!doc) return source;
  const list = doc.getIn(path, true);
  if (!isSeq(list)) {
    doc.setIn(path, doc.createNode([value]));
    return write(doc);
  }
  const at = Math.max(0, Math.min(index, list.items.length));
  (list as YAMLSeq).items.splice(at, 0, doc.createNode(value));
  return write(doc);
}

/** Removes the item or key at `path`. */
export function removeIn(source: string, path: DocPath): string {
  const doc = open(source);
  if (!doc?.hasIn(path)) return source;
  doc.deleteIn(path);
  return write(doc);
}

/** Moves an item of the list at `path` from one place to another. */
export function moveIn(source: string, path: DocPath, from: number, to: number): string {
  const doc = open(source);
  if (!doc) return source;
  const list = doc.getIn(path, true);
  if (!isSeq(list)) return source;
  const items = (list as YAMLSeq).items;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return source;
  }
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return write(doc);
}

/**
 * Moves an item from one list to another, or within one: a step dragged to
 * another stage. `to` is the place in the target list as it is before the move.
 */
export function moveAcross(
  source: string,
  fromPath: DocPath,
  from: number,
  toPath: DocPath,
  to: number,
): string {
  const doc = open(source);
  if (!doc) return source;
  const origin = doc.getIn(fromPath, true);
  const target = doc.getIn(toPath, true);
  if (!isSeq(origin) || !isSeq(target)) return source;
  const sameList = origin === target;
  if (from < 0 || from >= origin.items.length) return source;
  let at = Math.max(0, Math.min(to, target.items.length));
  if (sameList && at > from) at -= 1;
  if (sameList && at === from) return source;
  const [item] = (origin as YAMLSeq).items.splice(from, 1);
  (target as YAMLSeq).items.splice(at, 0, item);
  return write(doc);
}

/** Replaces a step with another kind, keeping its name, id, if and the like. */
export function replaceStep(
  source: string,
  path: DocPath,
  kindKeys: readonly string[],
  next: Record<string, unknown>,
): string {
  const doc = open(source);
  if (!doc) return source;
  const step = doc.getIn(path, true);
  if (!isMap(step)) return setIn(source, path, next);
  for (const key of kindKeys) {
    if ((step as YAMLMap).has(key)) (step as YAMLMap).delete(key);
  }
  (step as YAMLMap).delete("with");
  for (const [key, value] of Object.entries(next)) {
    (step as YAMLMap).set(key, doc.createNode(value));
  }
  return write(doc);
}
