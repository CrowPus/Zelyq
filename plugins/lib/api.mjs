export function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
export function segment(value) {
  return encodeURIComponent(String(value));
}
export function query(params) {
  const values = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  return values.length
    ? `?${values.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`
    : "";
}
export async function request(
  context,
  { url, urlEnv, tokenEnv, auth = "bearer", headers = [], timeoutMs = 30000 },
) {
  if (context.signal.aborted) return { output: "Cancelled.", isError: true };
  const env = tokenEnv.replace(/[^A-Z0-9_]/g, "");
  const authentication =
    auth === "basic" ? `--user "$${env}:"` : `--header "Authorization: Bearer $${env}"`;
  const extras = headers
    .map(
      (header) =>
        `--header ${header.includes("$") ? `"${header.replaceAll('"', '\\"')}"` : quote(header)}`,
    )
    .join(" ");
  const baseEnv = urlEnv?.replace(/[^A-Z0-9_]/g, "");
  const renderedUrl = baseEnv ? `"$${baseEnv}"${quote(url)}` : quote(url);
  const baseCheck = baseEnv
    ? `test -n "$${baseEnv}" || { echo ${quote(`Missing ${baseEnv} in the project runtime.`)} >&2; exit 2; }; `
    : "";
  const command = `${baseCheck}test -n "$${env}" || { echo ${quote(`Missing ${env} in the project runtime.`)} >&2; exit 2; }; curl --silent --show-error --fail-with-body --max-time ${Math.ceil(timeoutMs / 1000)} ${authentication} ${extras} ${renderedUrl}`;
  const destination = baseEnv ? `$${baseEnv}` : new URL(url).hostname;
  context.log(`Calling ${destination} using ${env}.`);
  const result = await context.runtime.exec(context.projectId, {
    command,
    timeoutMs: timeoutMs + 2000,
    maxOutputBytes: 30000,
  });
  const output = [
    result.stdout?.trim(),
    result.stderr?.trim(),
    `exit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // The response body is text from a third-party service — issue bodies,
  // comments, row data, doc pages — none of it under the user's control. Mark
  // it so the agent session wraps it as data, not instruction (finding E1).
  let source;
  try {
    source = new URL(url, "https://x").hostname || "external service";
  } catch {
    source = "external service";
  }
  return {
    output,
    untrusted: { source },
    ...(result.exitCode === 0 ? {} : { isError: true }),
  };
}
