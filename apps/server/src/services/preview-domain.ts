import { getDomain } from "tldts";

/**
 * Previews are other people's code. Their domain must be a site of its own:
 * not the app's address, not above it, and not beside it under the same
 * registered domain (`previews.zelyq.com` next to `app.zelyq.com` could set
 * cookies for `.zelyq.com`, and the browser would count both as one site).
 *
 * `allowSameSite` exists for a test server only (ZELYQ_ALLOW_SAME_SITE_PREVIEWS),
 * where a spare subdomain stands in for a domain not yet bought. It never
 * allows a preview domain that covers the app's own address.
 */
export function previewDomainProblem(
  domain: string,
  appHosts: string[],
  allowSameSite = false,
): string | null {
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    return "Preview domain must be a domain name, such as zelyq.app: lower case, no https:// and no path.";
  }
  const site = getDomain(domain, { allowPrivateDomains: true });
  if (!site) return `${domain} is a public suffix, not a domain of its own.`;
  for (const raw of appHosts) {
    const host = raw.toLowerCase();
    if (!host) continue;
    if (host === domain || host.endsWith(`.${domain}`)) {
      return `The preview domain cannot cover the app's own address (${host}). Use a domain of its own, such as zelyq.app.`;
    }
    if (!allowSameSite && getDomain(host, { allowPrivateDomains: true }) === site) {
      return `The preview domain ${domain} is on the same site as the app (${host}): previews could set its cookies. Use a domain of its own, such as zelyq.app.`;
    }
  }
  return null;
}

/** The hostnames in a list of addresses, ignoring empty and unreadable ones. */
export function hostsOf(addresses: Array<string | undefined | null>): string[] {
  return addresses.flatMap((address) => {
    try {
      return address ? [new URL(address).hostname.toLowerCase()] : [];
    } catch {
      return [];
    }
  });
}
