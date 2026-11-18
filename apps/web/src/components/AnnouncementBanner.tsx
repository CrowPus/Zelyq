import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Info, Megaphone, Wrench, X } from "lucide-react";
import { useEffect } from "react";
import { api, type InboxItem } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { t } from "../lib/i18n";

/**
 * What the server's operators want everyone (or this plan, team or person) to
 * see now: maintenance first, then the most urgent banner. One at a time, so
 * the page stays usable; each can be dismissed and stays dismissed.
 */
export function AnnouncementBanner() {
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: ["inbox-messages"],
    queryFn: api.inboxMessages,
    refetchInterval: 60_000,
    retry: false,
  });
  const mark = useMutation({
    mutationFn: (input: { id: string; what: "seen" | "dismiss" | "click" }) =>
      api.markAnnouncement(input.id, input.what),
    onSuccess: (_answer, input) => {
      if (input.what === "dismiss")
        void queryClient.invalidateQueries({ queryKey: ["inbox-messages"] });
    },
  });

  const rank = { urgent: 0, warning: 1, info: 2 } as const;
  const banner: InboxItem | undefined = [...(inbox.data?.banners ?? [])].sort(
    (a, b) => rank[a.level] - rank[b.level],
  )[0];
  const bannerId = banner?.id;
  // Counted once it has been shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per banner shown
  useEffect(() => {
    if (bannerId) mark.mutate({ id: bannerId, what: "seen" });
  }, [bannerId]);

  const maintenance = inbox.data?.maintenance;
  if (maintenance) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/25 bg-warning-subtle px-4 py-2 text-xs text-fg"
      >
        <Wrench size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-medium">
            {maintenance.underway ? t("Maintenance now") : t("Maintenance planned")}:{" "}
          </span>
          {maintenance.message} ({formatDateTime(maintenance.startsAt)} –{" "}
          {formatDateTime(maintenance.endsAt)})
          {maintenance.pauseBuilds ? t(". New building waits until it is over.") : ""}
        </span>
      </div>
    );
  }
  if (!banner) return null;

  const tone =
    banner.level === "urgent"
      ? "border-danger/25 bg-danger-subtle text-fg"
      : banner.level === "warning"
        ? "border-warning/25 bg-warning-subtle text-fg"
        : "border-info/25 bg-info-subtle text-fg";
  const Icon =
    banner.level === "urgent" ? CircleAlert : banner.level === "warning" ? Info : Megaphone;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs ${tone}`}
    >
      <Icon size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{banner.title}</span>
        {banner.body ? <span className="text-fg-secondary"> {banner.body}</span> : null}
      </span>
      {banner.link && (
        <a
          href={banner.link.url}
          onClick={() => mark.mutate({ id: banner.id, what: "click" })}
          className="text-info underline-offset-2 hover:underline"
          {...(banner.link.url.startsWith("https://")
            ? { target: "_blank", rel: "noreferrer" }
            : {})}
        >
          {banner.link.label}
        </a>
      )}
      <button
        type="button"
        aria-label={t("Dismiss")}
        className="text-fg-muted hover:text-fg"
        onClick={() => mark.mutate({ id: banner.id, what: "dismiss" })}
      >
        <X size={14} />
      </button>
    </div>
  );
}
