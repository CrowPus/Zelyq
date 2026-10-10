import { Clapperboard, ImagePlus } from "lucide-react";
import { Link } from "react-router-dom";

/** Studio is one module with two kinds of work in it: images and video. */
export function StudioSwitch({ current }: { current: "image" | "video" }) {
  return (
    <nav
      aria-label="Studio"
      className="flex items-center gap-0.5 rounded-md border border-border-default bg-surface-subtle p-0.5"
    >
      {(
        [
          ["image", "Image", ImagePlus],
          ["video", "Video", Clapperboard],
        ] as const
      ).map(([id, label, Icon]) => (
        <Link
          key={id}
          to={`/studio/${id}`}
          aria-current={current === id ? "page" : undefined}
          className={`flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
            current === id ? "bg-surface text-fg shadow-sm" : "text-fg-secondary hover:text-fg"
          }`}
        >
          <Icon size={12} strokeWidth={1.75} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
