import { isIP } from "node:net";
import { newId, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FigmaConnectionService } from "./figma-connections.js";
import { FIGMA_API } from "./figma-connections.js";
import { countNodes, pruneNode } from "./figma-tree-prune.js";

/**
 * Server-side extraction for `/figma` (proposal 068).
 *
 * Runs before the agent turn, the way the gateway inlines attachments. Pulls
 * the target frame's node tree, a PNG render, image-fill assets, and (when the
 * seat allows) Variables + Styles from the Figma REST API — always through
 * `FigmaConnectionService.withAccessToken`, so the token is in scope only for
 * the individual `fetch`. Writes a bundle into the project at `design/<key>/`
 * and returns a compact summary plus the directive the agent turn should run.
 *
 * The agent never sees the token, a raw Figma response, or a signed asset URL:
 * every asset is fetched here and rewritten to a local `design/<key>/assets/…`
 * path before `manifest.json` is written.
 */

const MAX_FRAMES = 15;
const RENDER_SCALE = 2;
const PER_ASSET_BYTES = 8 * 1024 * 1024;
const TOTAL_ASSET_BYTES = 60 * 1024 * 1024;
const NODE_DEPTH = 24;

export interface FigmaExtractInput {
  fileKey: string;
  /** The `node-id` from the share link — the frame to build. */
  nodeId: string;
  userId: string;
  projectId: string;
  /** Also pull the target frame's siblings on the same page (a flow). */
  wholePage?: boolean;
}

export interface FigmaExtractResult {
  ok: boolean;
  /** Shown to the user if extraction failed; relayed, no turn started. */
  error?: string;
  /** The message the agent turn runs (built here, with real frame names). */
  directive?: string;
  /** < 4 KB, for logging. */
  summary?: string;
  bundleDir?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: Figma API responses are untyped
type Json = any;

/** Proportionate check for a URL Figma's own authenticated API handed us. */
function assertPublicHttps(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`expected https, got ${url.protocol}`);
  if (url.username || url.password) throw new Error("credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new Error(`ip literal host ${host}`);
  if (/(^|\.)localhost$|\.local$|\.internal$/i.test(host))
    throw new Error(`non-public host ${host}`);
  return url;
}

export class FigmaExtractService {
  constructor(
    private readonly connections: FigmaConnectionService,
    private readonly runtime: RuntimeDriver,
    private readonly store: Store,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(input: FigmaExtractInput): Promise<FigmaExtractResult> {
    const key = input.fileKey;
    const bundleDir = `design/${sanitizeKey(key)}`;
    const notes: string[] = [];

    try {
      // 1. The target node (+ siblings if a whole page was asked for).
      const nodesResp = await this.figma<Json>(
        input.userId,
        `/v1/files/${enc(key)}/nodes?ids=${enc(input.nodeId)}&depth=${NODE_DEPTH}`,
      );
      const targetDoc = nodesResp?.nodes?.[input.nodeId]?.document;
      if (!targetDoc) {
        return fail(
          `Figma returned no node for ${input.nodeId} in file ${key}. Check the share link — it should point at a frame.`,
        );
      }

      // A link with node-id=0-1 (or any page/canvas) points at a whole PAGE,
      // not a frame — descend to its top-level FRAME/COMPONENT children so
      // bboxes are frame-relative and each frame is its own tree file.
      let frames: Json[];
      if (
        (targetDoc.type === "CANVAS" || targetDoc.type === "DOCUMENT") &&
        Array.isArray(targetDoc.children)
      ) {
        const childFrames: Json[] = targetDoc.children.filter(
          (c: Json) => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "SECTION",
        );
        if (childFrames.length === 0) {
          return fail(
            `The link points at a Figma page with no frames. Select a specific frame in Figma and Copy link to it.`,
          );
        }
        frames = childFrames.slice(0, MAX_FRAMES);
        if (childFrames.length > MAX_FRAMES) {
          notes.push(`page has ${childFrames.length} frames; capped at ${MAX_FRAMES}`);
        }
        // Re-fetch each frame at full depth from its own id — a depth-N pull
        // from the canvas is N-1 levels into the frame, which can clip a deep
        // dashboard.
        const ids = frames.map((f) => f.id).join(",");
        const full = await this.figma<Json>(
          input.userId,
          `/v1/files/${enc(key)}/nodes?ids=${enc(ids)}&depth=${NODE_DEPTH}`,
        );
        frames = frames.map((f) => full?.nodes?.[f.id]?.document ?? f);
      } else {
        frames = [targetDoc];
      }
      if (input.wholePage) {
        // The node response includes the parent chain only via a second call;
        // cheap path: pull the file at depth 2 and take the target's page.
        const fileResp = await this.figma<Json>(input.userId, `/v1/files/${enc(key)}?depth=2`);
        const pages: Json[] = fileResp?.document?.children ?? [];
        const page = pages.find((p) => (p.children ?? []).some((c: Json) => c.id === input.nodeId));
        if (page) {
          const siblings: Json[] = (page.children ?? []).filter(
            (c: Json) => c.type === "FRAME" || c.type === "COMPONENT",
          );
          frames = siblings.slice(0, MAX_FRAMES);
          if (siblings.length > MAX_FRAMES) {
            notes.push(`page has ${siblings.length} frames; capped at ${MAX_FRAMES}`);
          }
          // Re-fetch each sibling at full depth (the depth-2 file call is shallow).
          const ids = frames.map((f) => f.id).join(",");
          const full = await this.figma<Json>(
            input.userId,
            `/v1/files/${enc(key)}/nodes?ids=${enc(ids)}&depth=${NODE_DEPTH}`,
          );
          frames = frames.map((f) => full?.nodes?.[f.id]?.document ?? f);
        }
      }

      // 2. Prune + write one file per frame.
      const frameMeta: Array<{ id: string; name: string; slug: string; nodes: number }> = [];
      for (const frame of frames) {
        const pruned = pruneNode(frame, { maxDepth: NODE_DEPTH });
        const slug = frameSlug(frame.name ?? frame.id);
        await this.write(
          input.projectId,
          `${bundleDir}/tree/${slug}.json`,
          JSON.stringify(pruned, null, 2),
        );
        frameMeta.push({ id: frame.id, name: frame.name ?? slug, slug, nodes: countNodes(pruned) });
      }

      // 3. PNG renders of each frame.
      const renderIds = frameMeta.map((f) => f.id).join(",");
      const renders = await this.figma<Json>(
        input.userId,
        `/v1/images/${enc(key)}?ids=${enc(renderIds)}&format=png&scale=${RENDER_SCALE}`,
      );
      let totalBytes = 0;
      for (const meta of frameMeta) {
        const url = renders?.images?.[meta.id];
        if (!url) {
          notes.push(`no render for frame "${meta.name}"`);
          continue;
        }
        try {
          const bytes = await this.download(url, PER_ASSET_BYTES);
          totalBytes += bytes.length;
          await this.writeBinary(input.projectId, `${bundleDir}/render/${meta.slug}.png`, bytes);
        } catch (error) {
          notes.push(`render "${meta.name}" failed: ${(error as Error).message}`);
        }
      }

      // 4. Image-fill assets.
      const assetRecords: Array<{
        ref: string;
        file?: string;
        bytes?: number;
        ok: boolean;
        reason?: string;
      }> = [];
      try {
        const imageMeta = await this.figma<Json>(input.userId, `/v1/files/${enc(key)}/images`);
        const map: Record<string, string> = imageMeta?.meta?.images ?? {};
        for (const [ref, url] of Object.entries(map)) {
          if (totalBytes >= TOTAL_ASSET_BYTES) {
            notes.push("asset download stopped at the 60 MB budget");
            break;
          }
          try {
            const bytes = await this.download(url, PER_ASSET_BYTES);
            totalBytes += bytes.length;
            const ext = extFromUrl(url);
            const file = `${bundleDir}/assets/${ref.replace(/[^a-zA-Z0-9]/g, "")}.${ext}`;
            await this.writeBinary(input.projectId, file, bytes);
            assetRecords.push({ ref, file, bytes: bytes.length, ok: true });
          } catch (error) {
            assetRecords.push({ ref, ok: false, reason: (error as Error).message });
          }
        }
      } catch (error) {
        notes.push(`image-fill list failed: ${(error as Error).message}`);
      }

      // 5. Variables (Enterprise) → tokens.json; degrade to a note.
      let tokensAvailable = false;
      try {
        const vars = await this.figma<Json>(input.userId, `/v1/files/${enc(key)}/variables/local`);
        if (vars?.meta) {
          await this.write(
            input.projectId,
            `${bundleDir}/tokens.json`,
            JSON.stringify(vars.meta, null, 2),
          );
          tokensAvailable = true;
        }
      } catch {
        notes.push(
          "Figma Variables unavailable (needs an Enterprise seat) — derive tokens from styles + the frame",
        );
      }

      // 6. Styles map (always available on the file response).
      try {
        const fileShallow = await this.figma<Json>(input.userId, `/v1/files/${enc(key)}?depth=1`);
        if (fileShallow?.styles) {
          await this.write(
            input.projectId,
            `${bundleDir}/styles.json`,
            JSON.stringify(fileShallow.styles, null, 2),
          );
        }
      } catch (error) {
        notes.push(`styles fetch failed: ${(error as Error).message}`);
      }

      // 7. Manifest + log.
      await this.write(
        input.projectId,
        `${bundleDir}/manifest.json`,
        JSON.stringify(
          {
            extractedAt: new Date().toISOString(),
            fileKey: key,
            entryNodeId: input.nodeId,
            frames: frameMeta,
            tokensAvailable,
            assets: assetRecords,
            notes,
          },
          null,
          2,
        ),
      );
      await this.write(
        input.projectId,
        `${bundleDir}/EXTRACT.md`,
        [
          `# Figma extract — file ${key}`,
          "",
          `- when: ${new Date().toISOString()}`,
          `- frames: ${frameMeta.map((f) => `${f.name} (${f.nodes} nodes)`).join(", ")}`,
          `- tokens: ${tokensAvailable ? "from Variables" : "inferred (no Enterprise seat)"}`,
          `- assets: ${assetRecords.filter((a) => a.ok).length} copied, ${assetRecords.filter((a) => !a.ok).length} failed`,
          "",
          "## Notes",
          ...(notes.length ? notes.map((n) => `- ${n}`) : ["- (none)"]),
        ].join("\n"),
      );

      await this.audit(input, "ok", { frames: frameMeta.length, bytes: totalBytes });

      const summary = [
        `Extracted Figma file ${key} → ${bundleDir}/`,
        `Frames (${frameMeta.length}): ${frameMeta.map((f) => f.name).join(", ")}`,
        `Tokens: ${tokensAvailable ? "tokens.json (from Variables)" : "inferred — no Variables"}`,
        `Assets: ${assetRecords.filter((a) => a.ok).length} copied`,
        ...notes.map((n) => `Note: ${n}`),
      ].join("\n");

      return {
        ok: true,
        bundleDir,
        summary,
        directive: buildFigmaDirective(bundleDir, key, frameMeta),
      };
    } catch (error) {
      await this.audit(input, "error", { message: (error as Error).message }).catch(
        () => undefined,
      );
      if (error instanceof ZelyqError && error.code === "conflict") {
        return fail("Your Figma connection has expired. Reconnect it in Settings and try again.");
      }
      return fail(`Figma extraction failed: ${(error as Error).message}`);
    }
  }

  // — internals —

  private async figma<T>(userId: string, path: string): Promise<T> {
    return this.connections.withAccessToken(userId, async (token) => {
      const res = await this.fetchImpl(`${FIGMA_API}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        throw new Error(`Figma denied access (403) for ${path.split("?")[0]}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Figma ${res.status} for ${path.split("?")[0]}${body ? `: ${body.slice(0, 160)}` : ""}`,
        );
      }
      return (await res.json()) as T;
    });
  }

  private async download(rawUrl: string, maxBytes: number): Promise<Buffer> {
    const url = assertPublicHttps(rawUrl);
    const res = await this.fetchImpl(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`exceeds ${maxBytes} bytes`);
    return buf;
  }

  private async write(projectId: string, path: string, content: string): Promise<void> {
    await this.runtime.writeFile(projectId, path, content);
  }

  private async writeBinary(projectId: string, path: string, bytes: Buffer): Promise<void> {
    await this.runtime.writeFile(projectId, path, bytes.toString("base64"), "base64");
  }

  private async audit(
    input: FigmaExtractInput,
    outcome: "ok" | "error",
    detail: Record<string, unknown>,
  ): Promise<void> {
    const conn = await this.connections.connectionForUser(input.userId);
    await this.store.providerConnections.recordOperation({
      id: newId("providerOperation"),
      connectionId: conn?.id ?? null,
      zelyqProjectId: input.projectId,
      action: "extract",
      outcome,
      detail: { provider: "figma", fileKey: input.fileKey, ...detail },
      actorUserId: input.userId,
    });
  }
}

function fail(error: string): FigmaExtractResult {
  return { ok: false, error };
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "file";
}

function frameSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "frame"
  );
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function extFromUrl(url: string): string {
  const m = url.split("?")[0]?.match(/\.([a-z0-9]{2,5})$/i);
  return (m?.[1] ?? "png").toLowerCase();
}

/**
 * The message the agent turn runs — short, natural, pointing at the written
 * bundle and the skill's Figma profile. No XML; the transcript shows a compact
 * row (`figma-command.ts` `parseFigmaMessage`).
 */
export function buildFigmaDirective(
  bundleDir: string,
  fileKey: string,
  frames: Array<{ name: string; slug: string }>,
): string {
  const list = frames.map((f) => `"${f.name}" (${bundleDir}/tree/${f.slug}.json)`).join(", ");
  return [
    `Build a website from this Figma design — file ${fileKey}.`,
    ``,
    `The extraction is already in ${bundleDir}/: per-frame pruned node trees in tree/, PNG`,
    `renders in render/, image assets in assets/, plus manifest.json and (if the seat`,
    `allowed it) tokens.json. Frames: ${list}.`,
    ``,
    `Follow the complete-replica-engineering skill's Figma-design profile. This is a`,
    `REPLICA: your build must contain EVERY string in the tree verbatim (every heading,`,
    `label, number, caption) and EVERY section the render shows — do not invent`,
    `"representative" metrics or a "similar" set of cards. If the tree lists a text node`,
    `it appears in your output.`,
    ``,
    `The tree already has bbox, radius, fills, stroke, effects, opacity and text metrics`,
    `for every node — USE them. Do NOT decode ${bundleDir}/render/*.png pixel by pixel,`,
    `do NOT write node/python scripts to probe the image for radii or colors, do NOT`,
    `reach for sharp. A wrong value is fixed by the diff loop, not a pixel reader.`,
    ``,
    `1. Write ${bundleDir}/REPLICA.md — from the trees + renders: a full section`,
    `   inventory (count the panels/cards/rows in the render and list each with its`,
    `   text), the typography and colors it uses, the layout grid, and the acceptance`,
    `   level. No component code before this file exists.`,
    `2. Turn the tokens (tokens.json, or inferred from styles.json + the frames) into the`,
    `   project's theme — CSS variables + the Tailwind config — and a root DESIGN.md.`,
    `3. Build in THIS project's own framework, macro geometry first. Most Figma files`,
    `   have NO auto-layout — the frame's children are a flat list of rectangles`,
    `   (card/panel backgrounds) and text nodes with bboxes: sort by bbox.y then bbox.x,`,
    `   treat a big rectangle as a container and the text/vectors inside its bbox as its`,
    `   contents, group same-y nodes into flex/grid rows. NEVER position:absolute for`,
    `   page content. Copy assets from ${bundleDir}/assets/ locally; substitute + log`,
    `   any missing in ${bundleDir}/asset-gaps.md.`,
    `4. Diff loop — NOT one pass. start_preview, then capture_reference (mode "single",`,
    `   width = the frame's bbox.w, url = the preview, diffAgainst =`,
    `   "${bundleDir}/render/<frame>.png"). Iterate until changedRatio < 0.10 or 4`,
    `   passes. After each pass, inspect_image_asset the diff PNG, fix the largest red`,
    `   region, recapture. Record every pass's ratio in REPLICA.md.`,
    `5. Finish with the audit table (per frame/width: render vs replica, largest delta,`,
    `   acceptance level A/B/C) and token provenance (Variables / inferred). No`,
    `   "pixel-perfect" without the diff numbers.`,
  ].join("\n");
}
