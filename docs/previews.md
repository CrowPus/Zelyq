# Previews by name

Every running preview gets an address of its own, such as `coffee-shop-5fd3c2.zelyq.app`. No
preview ever gets a public port. One wildcard DNS record and one wildcard certificate cover all
of them. One web server rule sends every preview name to Zelyq. Zelyq reads the name, finds the
project by the six characters at the end, and forwards the request (live reload included) to
that project's dev server, which listens only inside the server.

This is how try.zelyq.com and the Zelyq cloud serve previews. A server without a preview domain
keeps working as it always has: `ZELYQ_PREVIEW_URL_TEMPLATE` with `{port}`, or the plain port.

## Use a domain of its own

Previews are other people's code. Put them on a domain used for nothing else, never a subdomain
of the app's domain. On the app's domain, a hostile preview could set cookies the app reads, and
a phishing page could pass for you.

Zelyq refuses a preview domain on the same site as the app: one that covers the app's address,
or sits beside it under the same registered domain (`previews.zelyq.com` next to
`app.zelyq.com`). It checks again when the app's address changes, and at start-up. A domain set
in the setting holds previews only: any other name under it (`www.`, `login.`, the domain itself)
gets a "not running" page, never the app.

A test server with no spare domain yet may set `ZELYQ_ALLOW_SAME_SITE_PREVIEWS=true` to use a
subdomain of its own site. Never on a server customers use.

For a public service, also add the domain to the [Public Suffix List](https://publicsuffix.org).
Browsers then treat every preview as a site of its own, so one customer's preview cannot set
cookies for another's. It takes weeks to reach browsers, so apply early.

## Set it up (Cloudflare DNS)

Once per server. Nothing needs doing again afterwards: the certificate renews by itself.

1. Add the domain to Cloudflare.
2. Make an API token for the domain's zone with **Zone → DNS → Edit**. Add
   **Zone → Zone Settings → Edit** too if Cloudflare will be in front (proxied), so the script
   can set SSL to Full (strict).
3. Save the token in a file only root can read, then run:

   ```bash
   sudo deploy/enable-named-previews.sh \
     --domain zelyq.app \
     --app-origin https://app.zelyq.com \
     --server-ip <this server's public IPv4> \
     --cloudflare-token-file /root/cloudflare-zelyq-app.token \
     --upstream 127.0.0.1:8787 \
     --admin-key-file /root/zelyq-admin.key
   ```

   The script:
   - points `*.zelyq.app` at the server in Cloudflare,
   - gets a wildcard certificate (proven through Cloudflare's API, so no record is ever pasted
     by hand),
   - leaves renewal to certbot's timer, which reloads nginx after each renewal,
   - installs the nginx site,
   - turns the preview domain on in Zelyq,
   - checks a preview name answers from outside.

   Options:
   - **`--check`**: only checks the token and the zone.
   - **`--dns-only`**: only points the record.
   - **`--staging`**: rehearses with Let's Encrypt's test service.
   - **`--proxied no`**: keeps Cloudflare out of the path.

   When Cloudflare is in front, the script sets the zone's SSL mode to Full (strict), but only if
   nothing else lives on the domain (otherwise it says so and leaves it). The nginx site also reads
   the visitor's real address from Cloudflare. The script refuses to go on if `*.<domain>` already
   has a record of another type, and it never puts a token on a command line.

The token stays on the server, in `/etc/letsencrypt/cloudflare-<domain>.ini` (root only), and is
used by certbot alone. Zelyq and the admin portal never see it.

## Turn it on or change it

On a managed server, the domain is set in the admin portal: **Zelyq → Settings → Preview →
Preview domain**. Elsewhere it is set in Settings → Preview, or `ZELYQ_PREVIEW_DOMAIN` seeds it.
It applies at once, with no restart. Emptying it turns named previews off.

## Watching it

Zelyq checks named previews every hour, from outside, the way a visitor's browser reaches them:

- **The wildcard name:** it resolves.
- **The certificate visitors get:** valid, with time left.
- **The certificate on the server:** the one renewal replaces. Behind Cloudflare it is not the
  one visitors see, so it is checked separately.
- **The preview router:** it answers.

When something needs attention, Zelyq emails the server's administrators and sends the
`previews.attention` event. It emails and sends `previews.recovered` again when everything is
fine. A certificate with under three weeks left counts as needing attention. Under one week, or
untrusted, or anything not answering, counts as down.

A bad result is checked again five minutes later before anyone hears of it, so one network
hiccup is not an email. What was last said is kept in the database, so a restart does not say
it again. A preview problem is shown in the server's health but never marks the whole server
down.

The admin portal shows all of this under **Zelyq → Health → Previews**, with a **Check now**
button. The same report is at `GET /api/admin/v1/previews` (scope `health`; add `?refresh=1` to
check now), and it is a line in `GET /api/admin/v1/health/deep`.

## Settings

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_PREVIEW_DOMAIN` | — | Seeds Settings → Preview → Preview domain. The setting wins once saved. |
| `ZELYQ_PREVIEW_URL_TEMPLATE` | — | The older way: `https://{name}.example.com` or `https://p{port}.example.com`. Used only while no preview domain is set. |
