import { type Project, previewDomainSuffix, previewTailFromHost } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import { readPreviewRecord } from "@zelyq/runtime";

type Target = { project: Project; port: number };
/** Long enough to cover a page's burst of requests, short enough that a
 * restarted preview on a new port is found within a breath. */
const RESOLVE_CACHE_MS = 5_000;

/**
 * Serving previews by name instead of by port.
 *
 * The port-in-the-hostname scheme (`p4380.preview.example.com`) exists
 * because a reverse proxy cannot know which project is on which port — only
 * Zelyq knows that. It works, and it has two costs: the address tells a
 * person nothing, and every port needs its own name on the TLS certificate,
 * which is how a deployment quietly hits Let's Encrypt's hundred-name ceiling
 * and finds its preview range frozen.
 *
 * With a wildcard certificate and this router, one address serves every
 * preview: `shop-a1b2c3.example.com` reaches whichever port that project's
 * dev server happens to be on today, and the range can be any size.
 *
 * Resolution is by the six-character tail, not the whole label, so a project
 * renamed after somebody bookmarked its address still resolves.
 */
export class PreviewRouter {
  /** tail → project id. Small, and only ever what has been asked for. */
  private readonly byTail = new Map<string, string>();
  /** tail → where it currently goes, for a few seconds. A page load is
   * dozens of requests in a burst; one record read per burst is plenty. */
  private readonly recent = new Map<string, { target: Target | null; until: number }>();

  constructor(
    private readonly store: Store,
    private readonly workspaceDir: string,
    /** The preview address template now: the admin's preview domain can change at any time. */
    private readonly urlTemplate: () => string | undefined,
    /**
     * Whether the preview domain holds previews only (true for the preview
     * domain setting, which may never cover the app). False for an older
     * ZELYQ_PREVIEW_URL_TEMPLATE, where the app may live at the domain itself
     * (try.zelyq.com, with previews at *.try.zelyq.com).
     */
    private readonly dedicated: () => boolean = () => false,
  ) {}

  /** The domain previews are served under, or null when this deployment
   * still serves them by port. */
  get domainSuffix(): string | null {
    return previewDomainSuffix(this.urlTemplate());
  }

  /**
   * Whether this host is anywhere under the preview domain (or is the domain
   * itself). Nothing but previews ever lives there: a name that is not a
   * preview must never be answered by the app, or `login.zelyq.app` would be
   * a convincing page beside customers' code.
   */
  isUnderPreviewDomain(hostname: string | undefined): boolean {
    if (!this.dedicated()) return false;
    const suffix = this.domainSuffix;
    if (!suffix || !hostname) return false;
    const host = hostname.toLowerCase().split(":")[0] ?? "";
    return host.endsWith(suffix) || host === suffix.slice(1);
  }

  /** Whether a request for this host is a preview rather than the app. */
  isPreviewHost(hostname: string | undefined): boolean {
    const suffix = this.domainSuffix;
    if (!suffix || !hostname) return false;
    const host = hostname.toLowerCase().split(":")[0] ?? "";
    if (!host.endsWith(suffix)) return false;
    return previewTailFromHost(host.slice(0, -suffix.length)) !== null;
  }

  /**
   * Where to send a request for this hostname: the loopback address of that
   * project's dev server.
   *
   * Answered from the preview's record on disk — the port the dev server was
   * given when it started — and cached briefly, never by asking the runtime
   * whether the preview is alive. That check runs a command inside the
   * container and costs a couple of seconds; on the path of every request a
   * page makes it turned a thirty-file load into a minute of stalls and
   * timeouts, which read as the preview flickering in and out. A stale
   * answer here is harmless: a stopped dev server refuses the connection,
   * and the next request re-reads the record.
   *
   * Null covers every "not here" case — an address for a project that no
   * longer exists, or one with no preview started — and the caller turns
   * that into a page a person can understand rather than a dead connection.
   */
  async resolve(hostname: string): Promise<{ project: Project; port: number } | null> {
    const suffix = this.domainSuffix;
    if (!suffix) return null;
    const host = hostname.toLowerCase().split(":")[0] ?? "";
    if (!host.endsWith(suffix)) return null;
    const tail = previewTailFromHost(host.slice(0, -suffix.length));
    if (!tail) return null;

    const cached = this.recent.get(tail);
    if (cached && cached.until > Date.now()) return cached.target;

    const project = await this.projectForTail(tail);
    if (!project) return null;

    const record = await readPreviewRecord(this.workspaceDir, project.id);
    const target = record?.port ? { project, port: record.port } : null;
    this.recent.set(tail, { target, until: Date.now() + RESOLVE_CACHE_MS });
    return target;
  }

  /** Drops what was remembered for a project's addresses: its preview just stopped or started. */
  forgetProject(projectId: string): void {
    for (const [tail, entry] of this.recent) {
      if (entry.target?.project.id === projectId || this.byTail.get(tail) === projectId) {
        this.recent.delete(tail);
      }
    }
  }

  /** The project a preview address names, running or not; null when it names none. */
  async projectFor(hostname: string): Promise<Project | null> {
    const suffix = this.domainSuffix;
    if (!suffix) return null;
    const host = hostname.toLowerCase().split(":")[0] ?? "";
    if (!host.endsWith(suffix)) return null;
    const tail = previewTailFromHost(host.slice(0, -suffix.length));
    return tail ? await this.projectForTail(tail) : null;
  }

  /** Drops what was remembered for a hostname, so the next request looks
   * again — used when the port it pointed at turned out to be dead. */
  forget(hostname: string | undefined): void {
    const suffix = this.domainSuffix;
    if (!suffix || !hostname) return;
    const host = hostname.toLowerCase().split(":")[0] ?? "";
    const tail = host.endsWith(suffix) ? previewTailFromHost(host.slice(0, -suffix.length)) : null;
    if (tail) this.recent.delete(tail);
  }

  private async projectForTail(tail: string): Promise<Project | null> {
    const cached = this.byTail.get(tail);
    if (cached) {
      const project = await this.store.projects.findById(cached);
      if (project) return project;
      this.byTail.delete(tail);
    }

    const project = await this.store.projects.findByIdSuffix(tail);
    if (project) this.byTail.set(tail, project.id);
    return project;
  }
}
