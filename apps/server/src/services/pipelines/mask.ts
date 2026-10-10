import { StringDecoder } from "node:string_decoder";

/**
 * Hides secret values in log output. A value is hidden in the forms a program
 * is likely to print it in: as is, base64, and URL-encoded. Masking happens
 * line by line: a secret split across two chunks of output is still caught,
 * because nothing is released until its line is complete.
 */
export class Masker {
  private readonly patterns: string[];
  private pending = "";
  /** A character split across two chunks of output is joined, not garbled. */
  private readonly decoder = new StringDecoder("utf8");

  constructor(values: Iterable<string>) {
    const forms = new Set<string>();
    for (const value of values) {
      // Very short values would hide ordinary words ("1", "on"); a secret that
      // short is not a secret anyone could keep anyway.
      if (value.length < 4) continue;
      forms.add(value);
      forms.add(Buffer.from(value).toString("base64").replace(/=+$/, ""));
      const encoded = encodeURIComponent(value);
      if (encoded !== value) forms.add(encoded);
      // Each line of a multi-line secret (a PEM key) on its own.
      for (const line of value.split(/\r?\n/)) if (line.trim().length >= 8) forms.add(line.trim());
    }
    // Longest first, so a value containing another is hidden whole.
    this.patterns = [...forms].sort((a, b) => b.length - a.length);
  }

  /** Same secrets, its own line buffer: one per output stream. */
  fork(): Masker {
    const copy = new Masker([]);
    (copy as unknown as { patterns: string[] }).patterns = this.patterns;
    return copy;
  }

  mask(text: string): string {
    let result = text;
    for (const pattern of this.patterns) result = result.split(pattern).join("***");
    return result;
  }

  /** Feeds output; returns the complete lines it now holds, masked. */
  push(chunk: string | Buffer): string[] {
    this.pending += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const parts = this.pending.split("\n");
    this.pending = parts.pop() ?? "";
    // A very long line with no newline is released anyway, so memory stays bounded.
    if (this.pending.length > 16_384) {
      parts.push(this.pending);
      this.pending = "";
    }
    return parts.map((line) => this.mask(line.replace(/\r$/, "")));
  }

  /** Whatever is left once the output ends. */
  flush(): string[] {
    const rest = this.pending + this.decoder.end();
    this.pending = "";
    return rest ? [this.mask(rest.replace(/\r$/, ""))] : [];
  }
}
