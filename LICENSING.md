# Licensing

Zelyq is **open source**, licensed under the **GNU Affero General Public License,
version 3** ([`LICENSE`](./LICENSE)). This page is a plain-language summary for
convenience — the binding terms are in `LICENSE` and, for the Enterprise
components, [`LICENSE_EE.md`](./LICENSE_EE.md).

## The short version

| You want to… | Allowed under the AGPL? |
| --- | --- |
| Run Zelyq — for yourself, your team, your company, anything | **Yes** |
| Read, modify, fork, and self-host it | **Yes** |
| Redistribute it, modified or not | **Yes**, under the AGPL, with the source |
| Run a **modified** Zelyq as a service other people use over a network | **Yes — but** you must offer those users the complete source of your modified version (AGPL §13) |
| Embed Zelyq inside a **closed-source** product, or run a modified version as a service **without** publishing your changes | **Not under the AGPL** — needs a commercial license |
| Use the features marked "Zelyq Enterprise" | **No** — separate paid subscription |
| Remove or hide the license, copyright, or Zelyq branding | **No** |

If you are unsure whether the AGPL works for you: **support@dee-empire.com**.

## The commercial license

The AGPL's §13 "network use" requirement — publish your source if you run a
modified version as a service — is deliberate, and it is the main reason some
organisations cannot adopt an AGPL project as-is.

Dee Empire offers a **commercial license** with the same code under terms that
drop that requirement, for:

- embedding Zelyq in a closed-source product;
- running a modified Zelyq as a hosted or managed service without publishing the
  modifications;
- organisations whose procurement or legal policy blocks AGPL software outright.

**support@dee-empire.com** for terms.

## Zelyq Enterprise

Some capabilities — identity federation (SAML, SCIM), audit export and retention,
policy enforcement, multi-instance fleet management, the production runtime host,
support with an SLA, and an IP indemnity — are **Zelyq Enterprise**. They live
under `ee` / `.ee` paths, are governed by [`LICENSE_EE.md`](./LICENSE_EE.md), and
require a subscription. They are added for organisations; they do not exist yet.

**Rule we hold ourselves to:** a capability that has ever been in the AGPL core
does not later move behind the Enterprise license. Enterprise features are new
capability.

## Why AGPL, and not MIT or Apache?

Zelyq shipped `v0.1.0` under Apache-2.0. A permissive license lets a
well-resourced third party run Zelyq as a closed, hosted service and out-compete
the maintainer on distribution, with nothing owed back — which is how a project
that intends to fund full-time development ends up unable to.

The AGPL keeps Zelyq genuinely open source (OSI-approved, no usage restrictions
on running it) while making the one activity a hyperscaler is best placed to do —
running a *closed* modified version as a service — require either publishing those
modifications or a commercial license. The rest of the world is unaffected.

`v0.1.0` and every earlier commit remain available under Apache-2.0. That grant
is irrevocable.

## Contributions

Contributions are welcome, under a
[Contributor License Agreement](./CLA.md). It keeps your copyright with you while
letting the project offer Zelyq under both the AGPL and a commercial license — a
dual-licensed project cannot relicense a contribution it only received under the
AGPL. You accept it by signing off your commits (`git commit -s` adds a
`Signed-off-by` line) and confirming when prompted on your first pull request.
Contributions to `research/` are instead covered by CC BY 4.0, per
[research/00-front-matter/02-copyright.md](./research/00-front-matter/02-copyright.md).

## Trademarks

"Zelyq" and the Zelyq logo are trademarks of Dee Empire. You may use the name to
refer accurately to the software; you may not use it as the name of your own
product, service, or distribution without permission. The AGPL grants no
trademark rights.
