import { Resolver } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { z } from "zod";
import { guardedLookup, guardedRequest } from "../../net-guard.js";
import type { OpsAction } from "../actions.js";
import { environmentRow, nameField, proveDeployment } from "./shared.js";

const domainField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, "A domain, like shop.example.com.");

const urlInput = z.object({ url: z.string().trim().url() }).strict();
const checkUrl: OpsAction<z.infer<typeof urlInput>> = {
  name: "check_url",
  description:
    "Open an address from Zelyq's server and say what it answered and how fast. Public addresses only (not this server, not private networks).",
  input: urlInput,
  risk: "read",
  words: (inputs) => `Open ${inputs.url}`,
  async run(_ctx, inputs) {
    try {
      const answer = await guardedRequest(inputs.url, {
        level: "strict",
        timeoutMs: 15_000,
        maxBytes: 0,
      });
      return {
        ok: answer.status >= 200 && answer.status < 400,
        summary: `${inputs.url} answered ${answer.status} in ${answer.ms} ms.`,
        data: { status: answer.status, ms: answer.ms, location: answer.headers.location ?? null },
      };
    } catch (error) {
      return { ok: false, summary: `${inputs.url}: ${(error as Error).message}` };
    }
  },
};

const deploymentInput = z
  .object({ environment: nameField("environment"), app: z.string().trim().min(1).max(40) })
  .strict();
const checkDeployment: OpsAction<z.infer<typeof deploymentInput>> = {
  name: "check_deployment",
  description:
    "Whether an app is up: its live version, its container, and its health page answering.",
  input: deploymentInput,
  risk: "read",
  words: (inputs) => `Check that ${inputs.app} on ${inputs.environment} answers`,
  async run(ctx, inputs) {
    const proof = await proveDeployment(ctx, inputs.environment, inputs.app);
    return {
      ok: proof.ok,
      summary: `${proof.target}: ${proof.detail ?? (proof.ok ? "up" : "down")}`,
      data: proof,
    };
  },
};

/** Asks public resolvers, so the answer is what visitors get, not what this server has cached. */
function publicResolver(): Resolver {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  return resolver;
}

const dnsInput = z
  .object({
    domain: domainField,
    /** Say whether the domain leads to this environment's machine. */
    environment: nameField("environment").optional(),
  })
  .strict();
const checkDns: OpsAction<z.infer<typeof dnsInput>> = {
  name: "check_dns",
  description:
    "What a domain points at, asked of public DNS (what visitors see), and whether it leads to an environment's machine.",
  input: dnsInput,
  risk: "read",
  words: (inputs) => `Look up ${inputs.domain} in public DNS`,
  async run(ctx, inputs) {
    const resolver = publicResolver();
    const [a, aaaa, cname] = await Promise.all([
      resolver.resolve4(inputs.domain).catch(() => [] as string[]),
      resolver.resolve6(inputs.domain).catch(() => [] as string[]),
      resolver.resolveCname(inputs.domain).catch(() => [] as string[]),
    ]);
    let expected: string | null = null;
    let leads: boolean | null = null;
    if (inputs.environment) {
      const environment = await environmentRow(ctx, inputs.environment);
      expected = environment.address;
      if (expected) {
        const targets = /^[0-9.]+$/.test(expected)
          ? [expected]
          : await resolver.resolve4(expected).catch(() => [] as string[]);
        leads = a.some((address) => targets.includes(address));
      }
    }
    const found = [...a, ...aaaa, ...cname.map((name) => `${name} (alias)`)];
    return {
      ok: found.length > 0 && leads !== false,
      summary:
        found.length === 0
          ? `${inputs.domain} has no DNS record yet.`
          : `${inputs.domain} → ${found.join(", ")}${leads === null ? "" : leads ? ` (leads to ${expected})` : ` (does NOT lead to ${expected})`}.`,
      data: { a, aaaa, cname, expected, leadsToEnvironment: leads },
    };
  },
};

const certificateInput = z.object({ domain: domainField }).strict();
const checkCertificate: OpsAction<z.infer<typeof certificateInput>> = {
  name: "check_certificate",
  description:
    "The HTTPS certificate a domain shows: valid or not, for which names, who issued it, how many days are left.",
  input: certificateInput,
  risk: "read",
  words: (inputs) => `Check ${inputs.domain}'s HTTPS certificate`,
  run: (_ctx, inputs) =>
    new Promise((resolve) => {
      const socket = tlsConnect({
        host: inputs.domain,
        port: 443,
        servername: inputs.domain,
        rejectUnauthorized: false,
        lookup: guardedLookup("strict") as never,
        timeout: 10_000,
      });
      const finish = (outcome: { ok: boolean; summary: string; data?: unknown }) => {
        socket.destroy();
        resolve(outcome);
      };
      socket.once("secureConnect", () => {
        const certificate = socket.getPeerCertificate();
        const expires = certificate.valid_to ? new Date(certificate.valid_to) : null;
        const days = expires ? Math.floor((expires.getTime() - Date.now()) / 86_400_000) : null;
        const valid = socket.authorized;
        finish({
          ok: valid && (days ?? 0) > 0,
          summary: valid
            ? `${inputs.domain}'s certificate is valid, ${days} days left (issued by ${certificate.issuer?.O ?? certificate.issuer?.CN ?? "?"}).`
            : `${inputs.domain}'s certificate is not trusted: ${socket.authorizationError ?? "unknown reason"}.`,
          data: {
            valid,
            reason: socket.authorizationError ? String(socket.authorizationError) : null,
            names: certificate.subjectaltname ?? null,
            issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? null,
            expires: expires?.toISOString() ?? null,
            daysLeft: days,
          },
        });
      });
      socket.once("timeout", () =>
        finish({ ok: false, summary: `${inputs.domain} did not answer on 443.` }),
      );
      socket.once("error", (error) =>
        finish({ ok: false, summary: `${inputs.domain}: ${error.message}` }),
      );
    }),
};

export const CHECK_ACTIONS = [
  checkUrl,
  checkDeployment,
  checkDns,
  checkCertificate,
] as unknown as OpsAction[];
