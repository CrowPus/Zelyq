import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { MessagesToPeople } from "../services/messages-to-people.js";

/**
 * What a signed-in person sees from the server's operators: banners, the
 * announcements and messages in their bell, and maintenance. Each person
 * reads and marks only their own.
 */
export function registerMessageRoutes(
  app: FastifyInstance,
  deps: { messages: MessagesToPeople; access: AccessControl },
): void {
  const { messages, access } = deps;

  app.get("/api/inbox/messages", async (request) => messages.inboxFor(access.requireUser(request)));

  for (const what of ["seen", "dismiss", "click"] as const) {
    app.post<{ Params: { id: string } }>(`/api/inbox/announcements/:id/${what}`, async (request) =>
      messages.markAnnouncement(access.requireUser(request), request.params.id, what),
    );
  }

  app.post<{ Params: { id: string } }>("/api/inbox/notifications/:id/read", async (request) =>
    messages.markRead(access.requireUser(request), request.params.id),
  );

  app.post("/api/inbox/notifications/read-all", async (request) =>
    messages.markRead(access.requireUser(request)),
  );
}
