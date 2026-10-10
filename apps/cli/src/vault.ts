/**
 * The client side of Vault's outside API: a service key, an address, and
 * nothing written anywhere. Separate from the command so it can be tested
 * without a terminal.
 */

export interface VaultClientOptions {
  /** Where Zelyq is, e.g. https://app.zelyq.com */
  url: string;
  /** A Vault service key: zvk_… */
  key: string;
  fetch?: typeof fetch;
}

export class VaultError extends Error {}

export class VaultClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: VaultClientOptions) {
    if (!options.url) throw new VaultError("Set ZELYQ_URL (or --url) to your Zelyq address.");
    if (!options.key) throw new VaultError("Set ZELYQ_VAULT_KEY to a Vault service key (zvk_…).");
    this.base = options.url.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
  }

  async names(): Promise<string[]> {
    const body = await this.get<{ secrets: { name: string }[] }>("/api/v1/vault/secrets");
    return body.secrets.map((secret) => secret.name);
  }

  async value(name: string): Promise<string> {
    const body = await this.get<{ value: string }>(
      `/api/v1/vault/secrets/${encodeURIComponent(name)}`,
    );
    return body.value;
  }

  /** Values for many names, 100 at a time. Every name must exist. */
  async values(names: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (let at = 0; at < names.length; at += 100) {
      const chunk = names.slice(at, at + 100);
      const body = await this.get<{
        secrets: { name: string; value: string }[];
        missing: string[];
      }>(`/api/v1/vault/secrets?names=${chunk.map(encodeURIComponent).join(",")}`);
      if (body.missing.length > 0) {
        throw new VaultError(`Not in Vault: ${body.missing.join(", ")}`);
      }
      for (const secret of body.secrets) result[secret.name] = secret.value;
    }
    return result;
  }

  private async get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        headers: { authorization: `Bearer ${this.options.key}` },
      });
    } catch (error) {
      throw new VaultError(
        `Could not reach ${this.base}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message = (body as { error?: { message?: string } }).error?.message;
      throw new VaultError(message ?? `Vault answered ${response.status}.`);
    }
    return body as T;
  }
}

/** Variable names a process environment can hold; Vault names may be looser. */
export function asEnvironmentName(name: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}
