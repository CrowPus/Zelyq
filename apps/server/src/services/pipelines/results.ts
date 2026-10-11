import type { RunnerOs } from "@zelyq/core";

/**
 * What a step leaves behind besides its log: the values it wrote to
 * `$ZELYQ_OUTPUT`, and the JUnit files its tests wrote. Both are read from
 * the machine by a small script sent as the shell's input.
 */

const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_TEST_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEST_FILES = 50;
const FILE_MARK = "@@ZELYQ-FILE@@";
const BIG_MARK = "@@ZELYQ-BIG@@";

function sq(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function psq(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Removes the output file (before a step) or prints and removes it (after). */
export function outputFileScript(os: RunnerOs, file: string, read: boolean): string {
  if (os === "windows") {
    return [
      read
        ? `if (Test-Path -LiteralPath ${psq(file)}) { [Console]::Out.Write([IO.File]::ReadAllText(${psq(file)})) }`
        : "",
      `Remove-Item -LiteralPath ${psq(file)} -Force -ErrorAction SilentlyContinue`,
      "",
    ].join("\r\n");
  }
  return [
    read ? `[ -f ${sq(file)} ] && head -c ${MAX_OUTPUT_BYTES} ${sq(file)}` : "",
    `rm -f ${sq(file)}`,
    "true",
    "",
  ].join("\n");
}

/** `name=value` lines, and `name<<END` … `END` for values over several lines. */
export function parseOutputs(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    const many = /^([A-Za-z_][A-Za-z0-9_]*)<<(.+)$/.exec(line);
    if (many) {
      const [, name, end] = many as unknown as [string, string, string];
      const body: string[] = [];
      for (index++; index < lines.length && lines[index] !== end; index++) {
        body.push(lines[index] as string);
      }
      values[name] = body.join("\n");
      continue;
    }
    const one = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (one) values[one[1] as string] = one[2] as string;
  }
  return values;
}

/** Only plain path characters and wildcards: the pattern is used by the shell. */
export function safeTestPattern(pattern: string): boolean {
  return /^[A-Za-z0-9._\-/*?]+$/.test(pattern) && !pattern.split("/").includes("..");
}

/** Prints each file matching the pattern, after a marker line with its name. */
export function testFilesScript(os: RunnerOs, dir: string, pattern: string, bash: boolean): string {
  if (os === "windows") {
    const like = pattern.replaceAll("/", "\\").replaceAll("**\\", "*");
    return [
      "$ErrorActionPreference = 'Stop'",
      `Set-Location -LiteralPath ${psq(dir)}`,
      "$base = (Get-Location).Path.TrimEnd('\\') + '\\'",
      "$n = 0",
      "Get-ChildItem -Recurse -File | ForEach-Object {",
      "  $rel = $_.FullName.Substring($base.Length)",
      `  if ($rel -like ${psq(like)} -and $n -lt ${MAX_TEST_FILES}) {`,
      "    $n++",
      `    if ($_.Length -gt ${MAX_TEST_FILE_BYTES}) { [Console]::Out.Write("\`n${BIG_MARK} $rel\`n") }`,
      `    else { [Console]::Out.Write("\`n${FILE_MARK} $rel\`n"); [Console]::Out.Write([IO.File]::ReadAllText($_.FullName)) }`,
      "  }",
      "}",
      "",
    ].join("\r\n");
  }
  return [
    `cd ${sq(dir)} || exit 1`,
    bash ? "shopt -s globstar nullglob" : "",
    "n=0",
    `for f in ${pattern}; do`,
    '  [ -f "$f" ] || continue',
    `  n=$((n+1)); [ "$n" -gt ${MAX_TEST_FILES} ] && break`,
    `  if [ "$(wc -c < "$f")" -gt ${MAX_TEST_FILE_BYTES} ]; then printf '\\n${BIG_MARK} %s\\n' "$f"; continue; fi`,
    `  printf '\\n${FILE_MARK} %s\\n' "$f"`,
    '  cat "$f"',
    "done",
    "true",
    "",
  ].join("\n");
}

/** The files the script printed, and those skipped for their size. */
export function splitTestFiles(text: string): {
  files: { name: string; xml: string }[];
  big: string[];
} {
  const files: { name: string; xml: string }[] = [];
  const big: string[] = [];
  const parts = text.split(/\r?\n(?=@@ZELYQ-(?:FILE|BIG)@@ )/);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const head = (newline === -1 ? part : part.slice(0, newline)).replace(/\r$/, "");
    if (head.startsWith(`${BIG_MARK} `)) big.push(head.slice(BIG_MARK.length + 1));
    else if (head.startsWith(`${FILE_MARK} `)) {
      files.push({
        name: head.slice(FILE_MARK.length + 1),
        xml: newline === -1 ? "" : part.slice(newline + 1),
      });
    }
  }
  return { files, big };
}
