import { createHash, createPublicKey, verify } from "node:crypto";
import {
  type PipelinePluginSummary,
  pluginSignaturePayload,
  type RegistryPluginDetail,
  type RegistryPluginSummary,
  type User,
  ZelyqError,
} from "@zelyq/core";
import { MAX_PLUGIN_PACKAGE_BYTES } from "@zelyq/core/node";
import type { Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import type { SettingsService } from "../settings.js";
import type { PipelinePluginService } from "./plugins.js";

/**
 * The public keys Zelyq trusts for plugins from Zelyq's registry. A package
 * is installed only if one of these signed it: the registry itself cannot
 * hand an installation anything else. A self-hoster running their own
 * registry names its key in ZELYQ_PLUGIN_REGISTRY_KEYS instead.
 */
export const ZELYQ_REGISTRY_KEYS: string[] = [
  // zelyq.store, key 043bea36bb217b43
  "MCowBQYDK2VwAyEAvIkmpfTK0BZRlw6X13C7jf0Q3E9Z4xgz1IB2MHYEX50=",
];

interface Installation {
  id: string;
  key: string;
}

/**
 * Zelyq's plugin registry, seen from this installation: what is available,
 * and installing a version for a team — only after its signature and
 * fingerprint check out. What is installed is this server's own copy, as if
 * uploaded by hand, so runs never depend on the registry being up.
 */
export class PluginRegistryClient {
  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService,
    private readonly access: AccessControl,
    private readonly plugins: PipelinePluginService,
    private readonly options: { trustedKeys: string[]; zelyqVersion: string },
  ) {}

  async enabled(): Promise<boolean> {
    return this.settings.booleanValue("pluginRegistry");
  }

  private async base(): Promise<string> {
    return (await this.settings.value("pluginRegistryUrl")).replace(/\/+$/, "");
  }

  private async installation(base: string, fresh = false): Promise<Installation> {
    const settingKey = `plugin-registry:installation:${base}`;
    const saved = fresh ? null : await this.store.settings.get(settingKey);
    if (saved) return JSON.parse(saved) as Installation;
    const response = await fetch(`${base}/v1/installations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zelyqVersion: this.options.zelyqVersion }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new ZelyqError(
        "runtime_unavailable",
        "The plugin registry cannot be reached just now.",
      );
    }
    const installation = (await response.json()) as Installation;
    await this.store.settings.set(settingKey, JSON.stringify(installation));
    return installation;
  }

  /** A call as this installation; registers again once if the registry forgot it. */
  private async call(path: string): Promise<Response> {
    if (!(await this.enabled())) {
      throw new ZelyqError("forbidden", "The plugin registry is turned off on this instance.");
    }
    const base = await this.base();
    for (const fresh of [false, true]) {
      const { key } = await this.installation(base, fresh);
      const response = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (!response) {
        throw new ZelyqError(
          "runtime_unavailable",
          "The plugin registry cannot be reached just now.",
        );
      }
      if (response.status === 401 && !fresh) continue;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ZelyqError(
          response.status === 404 ? "not_found" : "bad_request",
          body.error ?? `The plugin registry answered ${response.status}.`,
        );
      }
      return response;
    }
    throw new ZelyqError("runtime_unavailable", "The plugin registry refused this installation.");
  }

  async list(
    user: User,
    teamId: string,
    query: { q?: string; category?: string },
  ): Promise<RegistryPluginSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const response = await this.call(`/v1/plugins${params.size ? `?${params}` : ""}`);
    return ((await response.json()) as { plugins: RegistryPluginSummary[] }).plugins;
  }

  async detail(user: User, teamId: string, id: string): Promise<RegistryPluginDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const response = await this.call(`/v1/plugins/${pluginPath(id)}`);
    return ((await response.json()) as { plugin: RegistryPluginDetail }).plugin;
  }

  /** Versions withdrawn from the registry, for a warning beside what a team installed. */
  async yanked(): Promise<{ id: string; version: string; reason: string }[]> {
    if (!(await this.enabled())) return [];
    try {
      const response = await this.call("/v1/yanked");
      return (
        (await response.json()) as { yanked: { id: string; version: string; reason: string }[] }
      ).yanked;
    } catch {
      return [];
    }
  }

  /**
   * Downloads a version, checks its fingerprint and our signature, and
   * installs it for the team exactly as a hand upload would be.
   */
  async install(
    user: User,
    teamId: string,
    id: string,
    version: string,
  ): Promise<PipelinePluginSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) {
      throw ZelyqError.badRequest("Not a version.");
    }
    const response = await this.call(`/v1/plugins/${pluginPath(id)}/${version}/package`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_PLUGIN_PACKAGE_BYTES) {
      throw ZelyqError.badRequest("The registry sent a package larger than 10 MB.");
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const signature = response.headers.get("x-zelyq-signature") ?? "";
    if (
      response.headers.get("x-zelyq-sha256") !== sha256 ||
      !this.signedByUs(id, version, sha256, signature)
    ) {
      throw ZelyqError.badRequest(
        "This package is not signed by Zelyq's registry, so it was not installed.",
      );
    }
    return this.plugins.install(user, teamId, body);
  }

  private signedByUs(id: string, version: string, sha256: string, signature: string): boolean {
    if (!signature) return false;
    const payload = Buffer.from(pluginSignaturePayload(id, version, sha256));
    return this.options.trustedKeys.some((key) => {
      try {
        const publicKey = createPublicKey({
          key: Buffer.from(key, "base64"),
          format: "der",
          type: "spki",
        });
        return verify(null, payload, publicKey, Buffer.from(signature, "base64"));
      } catch {
        return false;
      }
    });
  }
}

/** `zelyq/slack-notify` as a URL path, refusing anything that is not an id. */
function pluginPath(id: string): string {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) throw ZelyqError.badRequest("Not a plugin id.");
  return id;
}
