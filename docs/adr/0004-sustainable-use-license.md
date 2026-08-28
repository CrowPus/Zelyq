# 4. Relicense from Apache-2.0 to the Sustainable Use License

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Zelyq shipped `v0.1.0` under Apache-2.0. Apache-2.0 permits anyone to take the
project and run it as a commercial hosted service with no obligation to contribute
back or pay. For a project that intends to fund full-time development, that leaves
no way to capture value from the one activity — reselling Zelyq as a service —
that a well-resourced third party is most able to do better and cheaper than the
maintainer.

The project is a few days old, has one copyright holder (Dee Empire), no outside
code contributions, and no known forks. The cost of changing the license is never
lower than it is now, and it only rises with adoption.

The buyer the project is being built for (see the private positioning notes) is a
team that self-hosts because its code cannot leave its network. That buyer needs
the source to be readable, modifiable, and self-hostable — none of which requires
an OSI-approved license — and is unaffected by a restriction on reselling Zelyq as
a service.

## Decision

Relicense everything except `research/` (which stays CC BY 4.0) and future
"Zelyq Enterprise" components from Apache-2.0 to the **Sustainable Use License**,
the same source-available license n8n uses:

- Free to use and modify for internal business use, and for personal or
  non-commercial use.
- Free to self-host, fork, and redistribute non-commercially.
- Not permitted: offering Zelyq to third parties as a hosted or managed service
  without a commercial agreement; removing licensing or branding notices.

Add a separate **Zelyq Enterprise License** (`LICENSE_EE.md`) for components under
`ee` / `.ee` paths or repositories, which require a paid subscription and a
license key. These do not exist yet; the license is defined now so the boundary is
a directory move later, not a scramble.

Accept contributions under a **Contributor License Agreement** (`CLA.md`) so the
project can offer Zelyq under both the Sustainable Use License and a commercial
license. A DCO sign-off alone does not grant the relicensing right.

`v0.1.0` and every earlier commit remain available under Apache-2.0; that grant is
irrevocable and is not being withdrawn.

## Consequences

**Good**

- The project can be funded without a third party reselling it as a service.
- The free experience is unchanged for individuals and for companies running it
  for their own work — the large majority of users.
- The enterprise boundary is defined before there is anything behind it, so the
  architecture is not distorted toward a paywall.
- IP is clean for a future commercial license or acquisition: one copyright
  holder, a CLA from day one, a registered trademark.

**Costs**

- Zelyq is no longer "open source" by the OSI definition. Expect "not real open
  source" / "rug pull" criticism. Mitigated by changing while the project is tiny,
  being explicit about why, and keeping `v0.1.0` under Apache-2.0.
- Some organisations' procurement rules block non-OSI licenses outright. Those
  turn into a commercial-license conversation or a lost user.
- Anyone may still fork `v0.1.0` and continue it under Apache-2.0. Low risk at
  current adoption; the risk is why this is being done now rather than later.
- The maintainer must hold the free/paid line credibly: a capability that has
  ever been free under the Sustainable Use License must not later move to the
  Enterprise License. This is a standing commitment, recorded in `LICENSING.md`.
