import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { ImageGeneration, VideoGeneration } from "@zelyq/core";
import { Check, Clapperboard, ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { uploadTargetPath } from "../lib/files";
import { Button, Input, Spinner } from "./ui";

type Picked = { kind: "image"; item: ImageGeneration } | { kind: "video"; item: VideoGeneration };

/**
 * Something the person already made in Image or Video Studio, put into the
 * app. The copy happens on the server — nothing is uploaded from this browser —
 * so a 100 MB clip lands as easily as a thumbnail, with no size limit and no
 * waiting on someone's connection.
 */
export function StudioMediaPicker({
  projectId,
  destDir,
  onClose,
  onPlaced,
}: {
  projectId: string;
  /** The folder the person was in; "" is the app's root. */
  destDir: string;
  onClose(): void;
  onPlaced(path: string): void;
}) {
  const [tab, setTab] = useState<"image" | "video">("image");
  const [picked, setPicked] = useState<Picked | null>(null);
  // Static assets are served from `public/` in every template; the root is
  // rarely what someone means.
  const [folder, setFolder] = useState(destDir || "public");
  const [name, setName] = useState("");

  const images = useInfiniteQuery({
    queryKey: ["studio-picker-images"],
    queryFn: ({ pageParam }) => api.imageHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: tab === "image",
  });
  const videos = useInfiniteQuery({
    queryKey: ["studio-picker-videos"],
    queryFn: ({ pageParam }) => api.videoHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: tab === "video",
  });
  const list = tab === "image" ? images : videos;
  const imageItems =
    images.data?.pages.flatMap((page) => page.generations).filter((g) => g.asset) ?? [];
  const videoItems =
    videos.data?.pages.flatMap((page) => page.generations).filter((g) => g.asset) ?? [];

  const extension = picked?.kind === "video" ? "mp4" : "png";
  const fileName = name.trim() ? withExtension(name.trim(), extension) : "";
  const target = fileName ? uploadTargetPath(folder, fileName) : "";

  const place = useMutation({
    mutationFn: () =>
      api.placeStudioMedia(projectId, {
        kind: picked!.kind,
        id: picked!.item.id,
        path: target,
      }),
    onSuccess: ({ path }) => onPlaced(path),
  });

  function choose(next: Picked) {
    setPicked(next);
    const prompt = next.kind === "image" ? next.item.prompt : next.item.input.prompt;
    setName(`${slug(prompt) || next.kind}.${next.kind === "video" ? "mp4" : "png"}`);
    place.reset();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Add from Studio"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-default bg-overlay text-fg shadow-overlay"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-default p-4">
          <div>
            <h2 className="text-sm font-semibold">Add from Studio</h2>
            <p className="mt-1 text-2xs text-fg-secondary">
              Copy an image or video you made into this app. Nothing is uploaded from your browser,
              so size is no problem.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:text-fg"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex gap-1 border-b border-border-default px-4 py-2">
          {(
            [
              ["image", "Images", ImageIcon],
              ["video", "Videos", Clapperboard],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                setPicked(null);
                setName("");
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                tab === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {list.isPending ? (
            <p className="flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner /> Reading your library…
            </p>
          ) : list.isError ? (
            <p role="alert" className="text-xs text-danger">
              {list.error instanceof ApiError ? list.error.message : "Could not read your library."}
            </p>
          ) : (tab === "image" ? imageItems : videoItems).length === 0 ? (
            <p className="text-xs text-fg-secondary">
              Nothing here yet.{" "}
              <Link to={`/studio/${tab}`} className="underline underline-offset-2">
                Make one in {tab === "image" ? "Image" : "Video"} Studio
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {tab === "image"
                ? imageItems.map((item) => (
                    <Tile
                      key={item.id}
                      selected={picked?.item.id === item.id}
                      label={item.prompt}
                      onClick={() => choose({ kind: "image", item })}
                    >
                      <img
                        src={item.asset!.url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </Tile>
                  ))
                : videoItems.map((item) => (
                    <Tile
                      key={item.id}
                      selected={picked?.item.id === item.id}
                      label={item.input.prompt}
                      detail={`${item.asset!.durationSeconds.toFixed(0)}s · ${(item.asset!.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                      onClick={() => choose({ kind: "video", item })}
                    >
                      <img
                        src={item.asset!.posterUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </Tile>
                  ))}
            </div>
          )}
          {list.hasNextPage && (
            <div className="mt-4 text-center">
              <Button
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border-default p-4">
          {picked ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (target) place.mutate();
              }}
            >
              <label
                htmlFor="studio-folder"
                className="flex flex-1 flex-col gap-1 text-2xs text-fg-secondary"
              >
                Folder
                <Input
                  id="studio-folder"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  placeholder="public"
                />
              </label>
              <label
                htmlFor="studio-name"
                className="flex flex-1 flex-col gap-1 text-2xs text-fg-secondary"
              >
                File name
                <Input
                  id="studio-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Button type="submit" variant="primary" disabled={!target || place.isPending}>
                {place.isPending ? "Adding…" : "Add to app"}
              </Button>
            </form>
          ) : (
            <p className="text-2xs text-fg-muted">Choose an image or a video above.</p>
          )}
          {target && !place.isError && (
            <p className="text-2xs text-fg-muted">
              Will be written to <span className="font-mono">{target}</span>
            </p>
          )}
          {place.isError && (
            <p role="alert" className="text-2xs text-danger">
              {place.error instanceof ApiError ? place.error.message : "Could not add it."}
            </p>
          )}
        </footer>
      </section>
    </div>
  );
}

function Tile({
  selected,
  label,
  detail,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  detail?: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={`overflow-hidden rounded-lg border bg-surface text-left ${
        selected ? "border-primary ring-2 ring-primary/30" : "border-border-default"
      }`}
    >
      <div className="relative aspect-[4/3] bg-canvas">
        {children}
        {selected && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-primary p-0.5 text-primary-fg">
            <Check size={11} />
          </span>
        )}
      </div>
      <p className="line-clamp-2 px-2 pt-1.5 text-2xs text-fg-secondary">{label}</p>
      {detail && <p className="px-2 pb-1.5 text-[10px] text-fg-muted">{detail}</p>}
      {!detail && <div className="pb-1.5" />}
    </button>
  );
}

/** A short, safe file name from a prompt: the first few words, lowercased. */
function slug(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join("-");
}

function withExtension(name: string, extension: string): string {
  return name.toLowerCase().endsWith(`.${extension}`)
    ? name
    : `${name.replace(/\.[a-z0-9]+$/i, "")}.${extension}`;
}
