/**
 * The line of a failed command's output that says why it failed. Docker (25+)
 * ends every `docker run` error with a blank line and "Run 'docker run --help'
 * for more information", so the last line is never the reason: hints like
 * that, and blank lines, are skipped, and Docker's own prefixes dropped.
 */
export function commandErrorReason(output: string, fallback = "unknown error"): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(Run|See) '[^']*--help'/.test(line));
  const last = lines.pop();
  if (!last) return fallback;
  return last.replace(/^docker: /, "").replace(/^Error response from daemon: /, "") || fallback;
}
