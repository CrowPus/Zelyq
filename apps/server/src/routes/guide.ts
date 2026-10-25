import { Readable } from "node:stream";
import { GUIDE_FILE_NAME, GUIDE_PDF_URL, ZelyqError } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";

/**
 * The beginner's guide as a download. The page shows the PDF straight from
 * where it is published, but a browser ignores `download` on a link to
 * another site and opens it instead — so a "Download" that downloads comes
 * through here, with the header that says "save this".
 */
export function registerGuideRoutes(app: FastifyInstance, deps: { access: AccessControl }): void {
  app.get("/api/guide/download", async (request, reply) => {
    deps.access.requireUser(request);
    const upstream = await fetch(GUIDE_PDF_URL, { redirect: "error" }).catch(() => null);
    if (!upstream?.ok || !upstream.body) {
      throw new ZelyqError(
        "internal",
        "The guide could not be fetched just now. Try again shortly.",
      );
    }
    reply
      .type("application/pdf")
      .header("content-disposition", `attachment; filename="${GUIDE_FILE_NAME}"`)
      .header("cache-control", "private, max-age=3600");
    const size = upstream.headers.get("content-length");
    if (size) reply.header("content-length", size);
    return reply.send(Readable.fromWeb(upstream.body as never));
  });
}
