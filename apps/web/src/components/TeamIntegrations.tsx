import { Puzzle } from "lucide-react";
import { FigmaIntegration } from "./FigmaIntegration";
import { SupabaseIntegration } from "./SupabaseIntegration";

/**
 * Team settings → Integrations: outside services the team brings its own
 * account for. Figma is each person's own; Supabase is the team's, managed by
 * its admins and used only by its apps.
 */
export function TeamIntegrations({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  return (
    <section className="mt-8" id="integrations" aria-label="Integrations">
      <h2 className="flex items-center gap-2 text-xs font-medium tracking-[0.06em] text-fg-muted uppercase">
        <Puzzle size={13} aria-hidden /> Integrations
      </h2>
      <p className="mt-1 text-xs text-fg-secondary">
        Outside services, with your own accounts. Figma is yours alone; the team's Supabase is
        shared by the team's apps.
      </p>
      <FigmaIntegration />
      {canManage ? (
        <SupabaseIntegration teamId={teamId} />
      ) : (
        <p className="mt-7 text-xs text-fg-muted">
          Supabase: a team admin connects the team's own Supabase account here.
        </p>
      )}
    </section>
  );
}
