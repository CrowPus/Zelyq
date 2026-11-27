/**
 * Zelyq's repository on GitHub, as the app shows it: the link, and how many people starred it.
 *
 * The count is asked of GitHub by this server, at most once an hour, so a person's browser never
 * talks to GitHub just by opening Zelyq. When GitHub cannot be reached (an offline install, a rate
 * limit), there is no number, and the button still works.
 */
export const ZELYQ_REPOSITORY = "https://github.com/CrowPus/Zelyq";

const HOUR = 60 * 60_000;
const RETRY = 10 * 60_000;

export class CommunityStars {
  private cached: { stars: number | null; until: number } | null = null;
  private pending: Promise<number | null> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly api = "https://api.github.com/repos/CrowPus/Zelyq",
    private readonly now: () => number = Date.now,
  ) {}

  async stars(): Promise<number | null> {
    if (this.cached && this.cached.until > this.now()) return this.cached.stars;
    this.pending ??= this.ask().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async ask(): Promise<number | null> {
    try {
      const response = await this.fetchImpl(this.api, {
        headers: { accept: "application/vnd.github+json", "user-agent": "Zelyq" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const body = (await response.json()) as { stargazers_count?: unknown };
      const stars = typeof body.stargazers_count === "number" ? body.stargazers_count : null;
      this.cached = { stars, until: this.now() + HOUR };
      return stars;
    } catch {
      // Keep the last known number a while longer rather than none at all.
      const stars = this.cached?.stars ?? null;
      this.cached = { stars, until: this.now() + RETRY };
      return stars;
    }
  }
}
