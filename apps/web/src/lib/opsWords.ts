import { t } from "./i18n";

/**
 * Ops writes its checks and alerts in English on the server ("shop on staging answers", "answered 200 in 5 ms"),
 * and keeps them that way in its records and messages. This turns the words it is known to write into the
 * reader's language; anything else (a name, an error from a machine) is shown as it came.
 */
type Values = Record<string, string>;
const PHRASES: Array<[string, (values: Values) => string]> = [
  ["{where} answers", (v) => t("{where} answers", v)],
  ["{where} answers at its usual speed", (v) => t("{where} answers at its usual speed", v)],
  ["{where} is running", (v) => t("{where} is running", v)],
  ["{machine}: disk, memory and reachable", (v) => t("{machine}: disk, memory and reachable", v)],
  ["{domain}: HTTPS certificate", (v) => t("{domain}: HTTPS certificate", v)],
  ["{domain} is found in public DNS", (v) => t("{domain} is found in public DNS", v)],
  [
    "Pipeline {pipeline} ships without failing",
    (v) => t("Pipeline {pipeline} ships without failing", v),
  ],
  ["{where} does not answer", (v) => t("{where} does not answer", v)],
  ["{where} is much slower than usual", (v) => t("{where} is much slower than usual", v)],
  ["{where} is not running properly", (v) => t("{where} is not running properly", v)],
  ["{machine} cannot be reached", (v) => t("{machine} cannot be reached", v)],
  ["{machine} needs attention", (v) => t("{machine} needs attention", v)],
  [
    "{domain}: the HTTPS certificate needs attention",
    (v) => t("{domain}: the HTTPS certificate needs attention", v),
  ],
  [
    "{domain} no longer leads to its machine",
    (v) => t("{domain} no longer leads to its machine", v),
  ],
  ["Pipeline {pipeline} failed", (v) => t("Pipeline {pipeline} failed", v)],
  ["answered {status} in {ms} ms", (v) => t("answered {status} in {ms} ms", v)],
  ["answered {status} (an error page)", (v) => t("answered {status} (an error page)", v)],
  ["no answer: {error}", (v) => t("no answer: {error}", v)],
  [
    "no answer (the answers check covers it)",
    (v) => t("no answer (the answers check covers it)", v),
  ],
  ["{ms} ms (learning its normal)", (v) => t("{ms} ms (learning its normal)", v)],
  ["{ms} ms (usually {normal} ms)", (v) => t("{ms} ms (usually {normal} ms)", v)],
  ["running", (v) => t("running", v)],
  ["its container is not on the machine", (v) => t("its container is not on the machine", v)],
  ["its container is {state}", (v) => t("its container is {state}", v)],
  ["not reachable: {error}", (v) => t("not reachable: {error}", v)],
  ["could not be looked at: {error}", (v) => t("could not be looked at: {error}", v)],
  [
    "{domain} is no longer found in public DNS",
    (v) => t("{domain} is no longer found in public DNS", v),
  ],
  ["{domain} leads to {address}", (v) => t("{domain} leads to {address}", v)],
  [
    "{domain} points at {addresses} (not the machine directly: a proxy or CDN in front is fine)",
    (v) =>
      t(
        "{domain} points at {addresses} (not the machine directly: a proxy or CDN in front is fine)",
        v,
      ),
  ],
  [
    "{domain}: certificate not valid ({error})",
    (v) => t("{domain}: certificate not valid ({error})", v),
  ],
  [
    "{domain}: certificate valid, {days} days left",
    (v) => t("{domain}: certificate valid, {days} days left", v),
  ],
  [
    "disk {disk}%, memory {memory}% free, load {load} on {cpus} processors",
    (v) => t("disk {disk}%, memory {memory}% free, load {load} on {cpus} processors", v),
  ],
  ["disk {disk}% full", (v) => t("disk {disk}% full", v)],
  ["memory almost gone ({memory}% free)", (v) => t("memory almost gone ({memory}% free)", v)],
  ["#{number} passed", (v) => t("#{number} passed", v)],
  ["#{number} failed", (v) => t("#{number} failed", v)],
  ["#{number} timed_out", (v) => t("#{number} timed_out", v)],
  ["back by itself", (v) => t("back by itself", v)],
  ["no longer watched (it was removed)", (v) => t("no longer watched (it was removed)", v)],
  ["the check was switched off by a person", (v) => t("the check was switched off by a person", v)],
];

let patterns: Array<{
  names: string[];
  fixed: number;
  pattern: RegExp;
  say: (values: Values) => string;
}> | null = null;
function compiled() {
  patterns ??= PHRASES.map(([english, say]) => {
    const names: string[] = [];
    const source = english
      .split(/(\{\w+\})/)
      .map((part, i) => {
        if (i % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(part.slice(1, -1));
        return "([\\s\\S]+?)";
      })
      .join("");
    const fixed = english.replace(/\{\w+\}/g, "").length;
    return { names, fixed, pattern: new RegExp(`^${source}$`), say };
  })
    // The most fixed text first: "{where} answers at its usual speed" before "{where} answers".
    .sort((a, b) => b.fixed - a.fixed);
  return patterns;
}

/** "shop on staging": the app and the environment it runs in. */
function place(where: string): string {
  const at = where.lastIndexOf(" on ");
  return at > 0
    ? t("{app} on {name}", { app: where.slice(0, at), name: where.slice(at + 4) })
    : where;
}

/** A check's title or result, an alert's title or how it ended, in the reader's language. */
export function opsText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  // A machine in trouble: "disk 96% full; memory almost gone (3% free) (disk 96%, memory 3% free, load …)".
  const trouble = /^(.+) \((disk .+ processors)\)$/.exec(text);
  if (trouble?.[1] && trouble[2])
    return `${trouble[1].split("; ").map(opsText).join("; ")} (${opsText(trouble[2])})`;
  for (const { names, pattern, say } of compiled()) {
    const found = pattern.exec(text);
    if (!found) continue;
    const values = Object.fromEntries(names.map((name, i) => [name, found[i + 1] ?? ""]));
    if (values.where) values.where = place(values.where);
    return say(values);
  }
  return text;
}
