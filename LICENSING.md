# Licensing

Zelyq is **source-available**, not open source. This page explains what that means
in practice. It is a summary for convenience — the binding terms are in
[`LICENSE`](./LICENSE) (Sustainable Use License) and [`LICENSE_EE.md`](./LICENSE_EE.md)
(Zelyq Enterprise License).

## The short version

| You want to… | Allowed under the free license? |
| --- | --- |
| Run Zelyq inside your company, for your own team and projects | **Yes** |
| Run it for yourself, personally or for non-commercial work | **Yes** |
| Read, modify, fork, and self-host it | **Yes** |
| Share your modified build for free, for non-commercial purposes | **Yes** |
| Offer Zelyq to third parties as a hosted or managed service | **No** — needs a commercial agreement |
| Use the features marked "Zelyq Enterprise" | **No** — needs a paid subscription |
| Remove or hide the license, copyright, or Zelyq branding | **No** |

If what you want to do isn't on this list, assume the free license covers it as
long as it's your own internal, personal, or non-commercial use — and ask if
you're not sure: **support@dee-empire.com**.

## Why not a permissive open-source license?

Zelyq was Apache-2.0 through `v0.1.0`. It was relicensed to the Sustainable Use
License so the project can be funded and developed full-time without a
well-resourced third party simply reselling it as a service. The overwhelming
majority of users — individuals and companies running it for their own work — are
unaffected and always will be. This is the same model n8n, Sentry, and others in
this category adopted for the same reason.

The Apache-2.0 terms continue to apply to `v0.1.0` and every earlier commit. They
are unaffected by this change.

## What's free, forever

The engine and everything needed to run it for your own work stays under the
Sustainable Use License and will not move behind the paywall:

- the agent, all model providers, and the tool suite
- `local` and `container` runtime, the `remote` driver, and the reference runtime host
- self-hosting with no seat limit
- projects, teams, roles, the per-turn change record (snapshot / diff / revert)
- the single-instance audit view
- the plugin and skill interfaces

**Rule we hold ourselves to:** a capability that has ever been available under the
free license does not later move to the Enterprise license. Enterprise features
are new capability, added for organisations.

## What needs a commercial agreement

- **Zelyq Enterprise features** — identity federation (SAML, SCIM), audit export
  and retention, policy enforcement, multi-instance fleet management, the
  production runtime host, support with an SLA, and an IP indemnity. These live
  under `ee` paths / repositories and require a subscription.
- **Offering Zelyq as a service to third parties** — a hosting or managed-service
  business built on Zelyq needs a separate written agreement.

For either: **support@dee-empire.com**.

## Contributions

Contributions are welcome. Contributors sign a [Contributor License Agreement](./CLA.md)
so the project can keep offering the software under these terms and a commercial
license alongside them. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Trademarks

"Zelyq" and the Zelyq logo are trademarks of Dee Empire. You may use the name to
refer accurately to the software; you may not use it as the name of your own
product, service, or distribution without permission.
