export const MAX_OUTPUT = 30000;

export function truncate(text, limit = MAX_OUTPUT) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.floor(limit * 0.75))}\n\n… [output truncated] …\n\n${value.slice(-Math.floor(limit * 0.15))}`;
}

export function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function exec(context, command, options = {}) {
  const settings = typeof options === "number" ? { timeoutMs: options } : options;
  if (context.signal.aborted) return { output: "Cancelled.", isError: true };
  context.log(`$ ${command}`);
  const result = await context.runtime.exec(context.projectId, {
    command,
    timeoutMs: settings.timeoutMs ?? 120000,
    maxOutputBytes: settings.maxOutputBytes ?? MAX_OUTPUT,
    ...(settings.cwd ? { cwd: settings.cwd } : {}),
  });
  const output = [
    result.stdout?.trim() && `stdout:\n${result.stdout.trim()}`,
    result.stderr?.trim() && `stderr:\n${result.stderr.trim()}`,
    `exit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { output: truncate(output), ...(result.exitCode !== 0 ? { isError: true } : {}) };
}

export async function readJson(context, path) {
  try {
    const file = await context.runtime.readFile(context.projectId, path);
    if (file.encoding !== "utf8") return null;
    return JSON.parse(file.content);
  } catch {
    return null;
  }
}

export async function readText(context, path) {
  try {
    const file = await context.runtime.readFile(context.projectId, path);
    return file.encoding === "utf8" ? file.content : null;
  } catch {
    return null;
  }
}

export async function projectFiles(context, depth = 8) {
  return context.runtime.listFiles(context.projectId, { depth });
}

export async function files(context, depth = 12) {
  return context.runtime.listFiles(context.projectId, { depth });
}

export async function writeText(context, path, content) {
  await context.runtime.writeFile(context.projectId, path, content);
  context.onFileChanged(path);
  return { output: `Wrote ${path} (${content.split("\n").length} lines).` };
}

export function jsonOutput(value) {
  return { output: truncate(JSON.stringify(value, null, 2)) };
}

export function chooseScript(pkg, names) {
  for (const name of names) if (pkg?.scripts?.[name]) return name;
  return null;
}
