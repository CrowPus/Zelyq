import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultFrameCount,
  defaultFrameWidth,
  type FrameExportInput,
  type FrameFormat,
  frameExtensions,
  frameFormats,
  isVideoActive,
  maxFrameCount,
  maxFrameWidth,
  maxVideoReferenceBytes,
  minFrameCount,
  minFrameWidth,
  randomUUID,
  type VideoFrameSet,
  type VideoGeneration,
  type VideoGenerationInput,
  type VideoProviderId,
  type VideoReference,
  videoInputError,
} from "@zelyq/core";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Film,
  ImagePlus,
  LockKeyhole,
  Play,
  RotateCw,
  Scissors,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  PageBody,
  PageHeader,
  Spinner,
  Tabs,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { ApiError, api } from "../lib/api";
import { formatDateParts, formatNumber } from "../lib/format";
import { t } from "../lib/i18n";
import { useTeamPaths } from "../lib/routes";

/** A half-typed number field must not become a failed request: an empty field
 *  reads as NaN, and "1" on the way to "120" is briefly out of range. */
function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const control =
  "mt-2 w-full rounded-lg border border-border-default bg-canvas px-3 py-2.5 text-sm text-fg outline-none focus:border-border-strong focus:ring-2 focus:ring-primary/20 disabled:opacity-50";
const states = {
  queued: t("In the queue"),
  submitting: t("Sending to the studio"),
  generating: t("Creating your video"),
  saving: t("Saving your video"),
  succeeded: t("Ready to play"),
  failed: t("Generation failed"),
  unknown: t("Result unconfirmed"),
  cancelled: t("Cancelled"),
};
const examples = [
  {
    title: t("A product in motion"),
    prompt: t(
      "A continuous slow orbit around an amber perfume bottle on warm travertine. Soft afternoon light glides over the glass, a linen curtain moves gently in the background. Refined editorial product film, stable bottle shape, no text. Gentle ambient sound, no dialogue.",
    ),
  },
  {
    title: t("An atmospheric world"),
    prompt: t(
      "A slow forward camera glide through a tiny botanical library floating above the clouds at blue hour. Warm windows, gently moving leaves, soft mist, intricate architecture. One continuous cinematic shot, no cuts, no text. Quiet wind and distant birds.",
    ),
  },
  {
    title: t("Illustration comes alive"),
    prompt: t(
      "A hand-painted storybook fox in a little flower shop carefully arranges a bouquet. Leaves sway gently and sunlight drifts across the wooden counter. Restrained animation, consistent character, warm gouache textures, no text.",
    ),
  },
];

export function VideoStudioPage() {
  const paths = useTeamPaths();
  // Studio and the model list use the team's own AI keys first.
  const { team: activeTeam } = useActiveTeam();
  const { user } = useSession();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("video");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState<VideoProviderId | null>(null);
  const [mode, setMode] = useState<VideoGenerationInput["mode"]>("text-to-video");
  const [ratio, setRatio] = useState<VideoGenerationInput["aspectRatio"]>("16:9");
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState<VideoGenerationInput["resolution"]>("720p");
  const [audio, setAudio] = useState(true);
  const [reference, setReference] = useState<VideoReference | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submission = useRef<VideoGenerationInput | null>(null);
  // Each team has its own Studio: what was made in another team is not shown here.
  const historyKey = ["video-history", user?.id, activeTeam?.id];
  const caps = useQuery({
    queryKey: ["video-capabilities", user?.id, activeTeam?.id],
    queryFn: () => api.videoCapabilities(activeTeam?.id),
  });
  const provider = caps.data?.providers.find((p) => p.id === (providerId ?? caps.data.provider));
  const history = useInfiniteQuery({
    queryKey: historyKey,
    queryFn: ({ pageParam }) => api.videoHistory(pageParam, activeTeam?.id),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.generations.some((g) => isVideoActive(g.status)))
        ? 3000
        : false,
  });
  const selected = useQuery({
    queryKey: ["video", user?.id, selectedId],
    queryFn: () => api.videoGeneration(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: (query) =>
      query.state.data && isVideoActive(query.state.data.generation.status) ? 3000 : false,
  });
  const entries = history.data?.pages.flatMap((page) => page.generations) ?? [];
  const current = selectedId ? selected.data?.generation : entries[0];
  // The clip in the preview — picked from Your films, or the newest one when
  // none is picked. Frames belong to that clip, not only to a picked one: the
  // panel shows for the newest clip too, and Extract on it used to send no id.
  const shownId = current?.id ?? null;
  const outstanding =
    (current && (isVideoActive(current.status) || current.status === "unknown")) ||
    entries.find((entry) => isVideoActive(entry.status) || entry.status === "unknown");
  const imageLibrary = useInfiniteQuery({
    queryKey: ["video-image-library", user?.id, activeTeam?.id],
    queryFn: ({ pageParam }) => api.imageHistory(pageParam, activeTeam?.id),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: libraryOpen,
  });
  const candidate: VideoGenerationInput | null = provider
    ? {
        provider: provider.id,
        model: provider.model,
        prompt: prompt.trim(),
        mode,
        aspectRatio: ratio,
        durationSeconds: duration,
        resolution,
        audio,
        ...(reference ? { referenceId: reference.id } : {}),
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
      }
    : null;
  const validation = candidate ? videoInputError(candidate) : null;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: historyKey });
    void client.invalidateQueries({ queryKey: ["video", user?.id] });
  };
  const generate = useMutation({
    mutationFn: async () => {
      if (!candidate) throw new Error(t("Choose a configured provider."));
      const previous = submission.current;
      const next = {
        ...candidate,
        idempotencyKey: previous?.idempotencyKey ?? randomUUID(),
      };
      if (previous && JSON.stringify(next) !== JSON.stringify(previous))
        next.idempotencyKey = randomUUID();
      submission.current = next;
      return api.generateVideo(next, activeTeam?.id);
    },
    onSuccess: ({ generation }) => {
      submission.current = null;
      client.setQueryData(["video", user?.id, generation.id], { generation });
      setParams({ video: generation.id });
      setError(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > maxVideoReferenceBytes)
        throw new Error(t("Starting images must be 8 MiB or smaller."));
      return api.uploadVideoReference(file);
    },
    onSuccess: ({ reference: next }) => {
      setReference(next);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const chooseImage = useMutation({
    mutationFn: api.videoReferenceFromImage,
    onSuccess: ({ reference: next }) => {
      setReference(next);
      setLibraryOpen(false);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const removeReference = async () => {
    if (!reference) return;
    const { id } = reference;
    // This button detaches the image from the draft, so let the composer go
    // first and clean up storage as a separate, best-effort question. The
    // upload is either retained by a saved video (409) or already gone —
    // deleting that video removes its inputs too, so a stale composer gets a
    // 404. Neither is the user's problem, and refusing to clear on one left
    // them unable to choose a different starting image at all.
    setReference(null);
    try {
      await api.deleteVideoReference(id);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status !== 404 && status !== 409) setError((e as Error).message);
    }
  };
  /** Frame export for the video currently in the preview. */
  const [frameFormat, setFrameFormat] = useState<FrameFormat>("webp");
  const [frameCount, setFrameCount] = useState(defaultFrameCount);
  const [frameWidth, setFrameWidth] = useState(defaultFrameWidth);
  const frames = useQuery({
    queryKey: ["video-frames", shownId],
    enabled: Boolean(shownId),
    retry: false,
    queryFn: async () => {
      try {
        return (await api.videoFrames(shownId as string)).frames;
      } catch (error) {
        // No set yet is the normal state, not a failure to report.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  /** Said here, in the panel, rather than left to a generic server rejection. */
  const frameProblem =
    !Number.isFinite(frameCount) || frameCount < minFrameCount || frameCount > maxFrameCount
      ? t("Choose between {minFrameCount} and {maxFrameCount} frames.", {
          minFrameCount,
          maxFrameCount,
        })
      : !Number.isFinite(frameWidth) || frameWidth < minFrameWidth || frameWidth > maxFrameWidth
        ? t("Choose a width between {minFrameWidth} and {maxFrameWidth} pixels.", {
            minFrameWidth,
            maxFrameWidth,
          })
        : null;
  const extract = useMutation({
    mutationFn: (input: FrameExportInput) => api.extractVideoFrames(shownId as string, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["video-frames", shownId] }),
    onError: (error) => {
      // The server names the offending fields in `details.issues`; showing only
      // "Request validation failed" tells the user nothing they can act on.
      const issues = (error as ApiError).details?.issues as
        | Array<{ path: string; message: string }>
        | undefined;
      setError(
        issues?.length
          ? `${(error as Error).message}: ${issues.map((i) => `${i.path} ${i.message}`).join(", ")}`
          : (error as Error).message,
      );
    },
  });
  const dropFrames = useMutation({
    mutationFn: () => api.deleteVideoFrames(shownId as string),
    onSuccess: () => client.invalidateQueries({ queryKey: ["video-frames", shownId] }),
  });

  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: "delete" | "cancel" | "reconcile" }) => {
      if (kind === "delete") {
        await api.deleteVideo(id, current?.status === "unknown");
        setParams({});
        setConfirmDelete(false);
      } else if (kind === "cancel") await api.cancelVideo(id);
      else await api.reconcileVideo(id);
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  function reuse(g: VideoGeneration) {
    setPrompt(g.input.prompt);
    setProviderId(g.input.provider);
    setMode(g.input.mode);
    setRatio(g.input.aspectRatio);
    setDuration(g.input.durationSeconds);
    setResolution(g.input.resolution);
    setAudio(g.input.audio);
    setReference(g.reference);
    submission.current = null;
    setError(null);
  }
  const busy = generate.isPending || upload.isPending || chooseImage.isPending;
  return (
    <AppShell crumbs={[{ label: t("Studio") }, { label: t("Video") }]}>
      <PageBody>
        <PageHeader
          title={t("Studio")}
          description={t(
            "Make images and short videos for your apps. What you make stays in the team’s private library.",
          )}
          meta={
            <Badge tone="neutral">
              <LockKeyhole size={11} className="mr-1" /> {t("Private library")}
            </Badge>
          }
          tabs={
            <Tabs
              label={t("Studio")}
              value={"video" as "image" | "video"}
              items={[
                { id: "image", label: t("Image"), to: paths.studioImage },
                { id: "video", label: t("Video"), to: paths.studioVideo },
              ]}
            />
          }
        />
        {caps.isError && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {caps.error.message}
          </p>
        )}
        <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section
            aria-label={t("Video composer")}
            className="rounded-2xl border border-border-default bg-surface p-5"
          >
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1">
              {(
                [
                  ["text-to-video", t("Text to video")],
                  ["image-to-video", t("Animate image")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-md px-2 py-2 text-xs font-medium ${mode === value ? "bg-surface text-fg" : "text-fg-muted hover:text-fg"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="block text-xs font-medium text-fg-secondary">
              {t("Video model")}
              <NativeSelect
                aria-label={t("Video model")}
                value={provider?.id ?? "google"}
                onChange={(e) => setProviderId(e.target.value as VideoProviderId)}
                className={control}
              >
                {caps.data?.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.modelLabel} · {p.label}
                    {!p.configured ? t(" · Set up key") : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {provider && !provider.configured && (
              <p className="mt-3 rounded-lg bg-canvas p-3 text-xs leading-relaxed text-fg-secondary">
                {t("This provider needs a video API key. ")}
                {user?.instanceRole === "admin" ? (
                  <Link to="/admin#video-generation" className="underline">
                    {t("Configure video in Server admin")}
                  </Link>
                ) : (
                  t("Ask an administrator to configure video in Server admin.")
                )}
              </p>
            )}
            {mode === "image-to-video" && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-fg-secondary">
                    {t("Starting frame")}
                  </span>
                  <span className="text-2xs text-fg-muted">{t("PNG, JPEG, WebP · 8 MiB")}</span>
                </div>
                {reference ? (
                  <div>
                    <div
                      className="relative overflow-hidden rounded-lg bg-black"
                      style={{ aspectRatio: ratio.replace(":", "/") }}
                    >
                      <img
                        src={reference.url}
                        alt={t("Starting frame preview")}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                      <button
                        type="button"
                        aria-label={t("Remove starting image")}
                        onClick={() => void removeReference()}
                        className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-fg-muted">
                      {t("Full image preserved. Black padding matches this preview.")}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border-strong p-5 text-center">
                    <ImagePlus size={23} className="mx-auto text-fg-muted" />
                    <label className="mt-3 inline-block cursor-pointer rounded-md border border-border-default px-3 py-2 text-xs text-fg">
                      <input
                        aria-label={t("Upload starting image")}
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) upload.mutate(file);
                          e.target.value = "";
                        }}
                      />
                      {upload.isPending ? t("Uploading…") : t("Upload an image")}
                    </label>
                    <button
                      type="button"
                      className="mt-3 block w-full text-xs text-fg-secondary underline underline-offset-4"
                      onClick={() => setLibraryOpen(!libraryOpen)}
                    >
                      {t("Choose from your images")}
                    </button>
                  </div>
                )}
                {libraryOpen && (
                  <div className="mt-3 rounded-lg border border-border-default p-3">
                    <div className="mb-3 flex justify-between text-xs text-fg-secondary">
                      {t("Your generated images")}
                      <button
                        type="button"
                        aria-label={t("Close image library")}
                        onClick={() => setLibraryOpen(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {imageLibrary.isPending ? (
                      <Spinner />
                    ) : imageLibrary.isError ? (
                      <p role="alert" className="text-xs text-danger">
                        {imageLibrary.error.message}
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {imageLibrary.data?.pages
                            .flatMap((p) => p.generations)
                            .filter((g) => g.asset)
                            .map((g) => (
                              <button
                                type="button"
                                key={g.id}
                                aria-label={t("Use image: {prompt}", { prompt: g.prompt })}
                                disabled={chooseImage.isPending}
                                onClick={() => chooseImage.mutate(g.id)}
                                className="overflow-hidden rounded-md focus:ring-2 focus:ring-primary"
                              >
                                <img
                                  src={g.asset!.url}
                                  alt={g.prompt}
                                  className="aspect-square w-full object-cover"
                                  loading="lazy"
                                />
                              </button>
                            ))}
                        </div>
                        {!imageLibrary.data?.pages.some((p) =>
                          p.generations.some((g) => g.asset),
                        ) && (
                          <p className="text-xs text-fg-muted">{t("No completed images yet.")}</p>
                        )}
                        {imageLibrary.hasNextPage && (
                          <button
                            type="button"
                            className="mt-3 text-xs underline"
                            onClick={() => void imageLibrary.fetchNextPage()}
                          >
                            {t("Load more images")}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <label className="mt-5 block text-xs font-medium text-fg-secondary">
              {t("Describe your scene")}
              <textarea
                aria-label={t("Video prompt")}
                className={`${control} min-h-[150px] resize-y leading-relaxed`}
                value={prompt}
                maxLength={4000}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "image-to-video"
                    ? t("How should this image move? Describe the action, camera, and atmosphere…")
                    : t("A slow camera glide through a sunlit garden, leaves moving in the breeze…")
                }
              />
            </label>
            <div className="mt-1 text-right text-2xs text-fg-muted">
              {formatNumber(prompt.length)} / 4,000
            </div>
            <fieldset className="mt-4">
              <legend className="text-xs font-medium text-fg-secondary">{t("Aspect ratio")}</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["16:9", "9:16", "1:1"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={ratio === value}
                    disabled={!provider?.ratios.includes(value)}
                    onClick={() => setRatio(value)}
                    className={`flex flex-col items-center gap-2 rounded-lg border py-3 text-xs disabled:opacity-30 ${ratio === value ? "border-fg bg-canvas text-fg" : "border-border-default text-fg-muted"}`}
                  >
                    <span
                      className={`block rounded-sm border border-current ${value === "16:9" ? "h-4 w-7" : value === "9:16" ? "h-6 w-3.5" : "h-5 w-5"}`}
                    />
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-fg-secondary">
                {t("Duration")}
                <NativeSelect
                  aria-label={t("Duration")}
                  className={control}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {!provider?.durations.includes(duration) && (
                    <option value={duration}>{t("{duration}s · unsupported", { duration })}</option>
                  )}
                  {provider?.durations.map((n) => (
                    <option key={n} value={n}>
                      {t("{n} seconds", { n })}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="text-xs font-medium text-fg-secondary">
                {t("Resolution")}
                <NativeSelect
                  aria-label={t("Resolution")}
                  className={control}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as typeof resolution)}
                >
                  {!provider?.resolutions.includes(resolution) && (
                    <option value={resolution}>
                      {t("{resolution} · unsupported", { resolution })}
                    </option>
                  )}
                  {provider?.resolutions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs text-fg-secondary">
              <Volume2 size={15} />
              <input
                type="checkbox"
                checked={audio}
                disabled={provider?.audio === "always" && audio}
                onChange={(e) => setAudio(e.target.checked)}
              />
              {t("Generate audio")}
              {provider?.audio === "always" && (
                <span className="ml-auto text-2xs text-fg-muted">{t("Included by model")}</span>
              )}
            </label>
            {validation && (
              <p role="status" className="mt-4 text-xs text-warning">
                {validation}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger"
              >
                {error}
              </p>
            )}
            <Button
              variant="primary"
              className="mt-5 w-full justify-center py-3"
              disabled={
                busy ||
                !provider?.configured ||
                !prompt.trim() ||
                Boolean(validation) ||
                Boolean(outstanding)
              }
              onClick={() => generate.mutate()}
            >
              {busy ? <Spinner /> : <Sparkles size={15} />}
              {generate.isPending ? t("Submitting…") : t("Generate video")}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-fg-muted">
              {outstanding
                ? t("Your current video is still outstanding. You can keep editing this draft.")
                : t("One clip per request · {hourlyLimit} requests per hour", {
                    hourlyLimit: caps.data?.hourlyLimit ?? 5,
                  })}
            </p>
            <p className="mt-1 text-center text-2xs text-fg-muted">
              {t("Billed to your provider account. Cost estimate unavailable.")}
            </p>
          </section>
          <div className="min-w-0 space-y-5">
            <section
              aria-label={t("Video preview")}
              className="overflow-hidden rounded-2xl border border-border-default bg-surface"
            >
              <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
                <span className="flex items-center gap-2 text-xs font-medium text-fg-secondary">
                  <Film size={15} /> {t("Preview")}
                </span>
                {current && (
                  <span role="status" className="text-xs text-fg-muted">
                    {states[current.status]}
                  </span>
                )}
              </div>
              {selected.isError ? (
                <p role="alert" className="p-8 text-sm text-danger">
                  {selected.error.message}
                </p>
              ) : current?.asset ? (
                <div className="grid min-h-[300px] place-items-center bg-black">
                  {/* biome-ignore lint/a11y/useMediaCaption: Provider outputs do not include captions. A fabricated track would misrepresent generated audio. */}
                  <video
                    key={current.id}
                    aria-label={t("Generated video")}
                    src={current.asset.url}
                    poster={current.asset.posterUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[580px] w-full"
                  />
                </div>
              ) : (
                <div className="relative flex min-h-[330px] flex-col items-center justify-center overflow-hidden bg-canvas px-8 py-14 text-center sm:min-h-[410px]">
                  <div className="mb-5 grid size-16 place-items-center rounded-2xl border border-border-default bg-surface text-fg-muted">
                    {current && isVideoActive(current.status) ? (
                      <Spinner />
                    ) : (
                      <Play size={25} strokeWidth={1.3} />
                    )}
                  </div>
                  <h2 className="text-xl font-medium tracking-tight text-fg">
                    {current ? states[current.status] : t("Every scene starts with an idea")}
                  </h2>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-muted">
                    {current?.error ??
                      (current && isVideoActive(current.status)
                        ? t(
                            "Your video is being created. You can leave this page and return when it’s ready.",
                          )
                        : current
                          ? t("Use the prompt again to explore a new direction.")
                          : t(
                              "Describe a moment or animate an image. Your finished film will appear here.",
                            ))}
                  </p>
                  {current && isVideoActive(current.status) && (
                    <p className="mt-4 text-xs text-fg-muted">
                      {t("Started {createdAt} · usually takes several minutes", {
                        createdAt: formatDateParts(current.createdAt, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </p>
                  )}
                </div>
              )}
              {current && (
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                    {[
                      current.input.model,
                      current.asset
                        ? `${current.asset.durationSeconds.toFixed(1)}s`
                        : `${current.input.durationSeconds}s`,
                      current.input.aspectRatio,
                      current.asset
                        ? `${current.asset.width} × ${current.asset.height}`
                        : current.input.resolution,
                      current.asset
                        ? current.asset.hasAudio
                          ? t("With audio")
                          : t("Silent")
                        : null,
                    ]
                      .filter(Boolean)
                      .map((value) => (
                        <span key={value} className="rounded-md bg-canvas px-2 py-1">
                          {value}
                        </span>
                      ))}
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-fg-secondary">
                    {current.input.prompt}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {current.asset && (
                      <a
                        href={`${current.asset.url}?download=1`}
                        download
                        className="inline-flex items-center gap-2 rounded-lg bg-fg px-3 py-2 text-xs font-medium text-canvas"
                      >
                        <ArrowDownToLine size={14} /> {t("Download MP4")}
                      </a>
                    )}
                    <Button onClick={() => reuse(current)}>
                      <RotateCw size={13} /> {t("Use prompt & settings")}
                    </Button>
                    {current.canReconcile && (
                      <Button
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: current.id, kind: "reconcile" })}
                      >
                        {t("Check existing job")}
                      </Button>
                    )}
                    {current.status === "queued" && (
                      <Button
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: current.id, kind: "cancel" })}
                      >
                        {t("Cancel queued video")}
                      </Button>
                    )}
                    {!isVideoActive(current.status) && (
                      <Button
                        onClick={() => setConfirmDelete(!confirmDelete)}
                        aria-label={t("Delete video")}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                  {confirmDelete && (
                    <div className="mt-3 rounded-lg border border-border-default p-3">
                      <p className="text-xs text-fg-secondary">
                        {current.status === "unknown"
                          ? t(
                              "Dismiss this unconfirmed job? The provider may still generate and charge for it. Dismissing releases your slot without requesting another video.",
                            )
                          : t("Delete this video and its saved inputs from your library?")}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          disabled={action.isPending}
                          onClick={() => action.mutate({ id: current.id, kind: "delete" })}
                        >
                          {t("Confirm delete")}
                        </Button>
                        <Button onClick={() => setConfirmDelete(false)}>{t("Keep it")}</Button>
                      </div>
                    </div>
                  )}
                  {/* Splitting the clip into the numbered sequence a
                        scroll-scrubbed hero needs. Nothing is billed here. */}
                  {current.status === "succeeded" && current.asset && (
                    <section
                      aria-label={t("Frame export")}
                      className="mt-4 rounded-xl border border-border-default p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-fg">{t("Split into frames")}</h3>
                        <span className="text-[11px] text-fg-muted">
                          {t("For a scroll-scrubbed hero")}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <label className="text-xs text-fg-secondary">
                          {t("Format")}
                          <NativeSelect
                            aria-label={t("Frame format")}
                            className={control}
                            value={frameFormat}
                            disabled={extract.isPending}
                            onChange={(e) => setFrameFormat(e.target.value as FrameFormat)}
                          >
                            {frameFormats.map((f) => (
                              <option key={f} value={f}>
                                {f.toUpperCase()}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                        <label className="text-xs text-fg-secondary">
                          {t("Frames {part}", {
                            part: (
                              <span className="text-fg-muted">
                                ({minFrameCount}–{maxFrameCount})
                              </span>
                            ),
                          })}
                          <Input
                            aria-label={t("Frame count")}
                            type="number"
                            className={control}
                            min={minFrameCount}
                            max={maxFrameCount}
                            value={Number.isFinite(frameCount) ? frameCount : ""}
                            disabled={extract.isPending}
                            onChange={(e) => setFrameCount(Number(e.target.value))}
                            onBlur={() =>
                              setFrameCount(
                                clamp(frameCount, minFrameCount, maxFrameCount, defaultFrameCount),
                              )
                            }
                          />
                        </label>
                        <label className="text-xs text-fg-secondary">
                          {t("Width {part}", {
                            part: (
                              <span className="text-fg-muted">
                                ({minFrameWidth}–{maxFrameWidth})
                              </span>
                            ),
                          })}
                          <Input
                            aria-label={t("Frame width")}
                            type="number"
                            className={control}
                            min={minFrameWidth}
                            max={maxFrameWidth}
                            step={80}
                            value={Number.isFinite(frameWidth) ? frameWidth : ""}
                            disabled={extract.isPending}
                            onChange={(e) => setFrameWidth(Number(e.target.value))}
                            onBlur={() =>
                              setFrameWidth(
                                clamp(frameWidth, minFrameWidth, maxFrameWidth, defaultFrameWidth),
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          disabled={extract.isPending || Boolean(frameProblem)}
                          onClick={() =>
                            extract.mutate({
                              format: frameFormat,
                              // Clamped, not trusted: a half-typed number in
                              // the field must never become a failed request.
                              count: clamp(
                                frameCount,
                                minFrameCount,
                                maxFrameCount,
                                defaultFrameCount,
                              ),
                              width: clamp(
                                frameWidth,
                                minFrameWidth,
                                maxFrameWidth,
                                defaultFrameWidth,
                              ),
                            })
                          }
                        >
                          {extract.isPending ? (
                            <>
                              <Spinner /> {t("Extracting…")}
                            </>
                          ) : (
                            <>
                              <Scissors size={13} /> {frames.data ? t("Re-extract") : t("Extract")}
                            </>
                          )}
                        </Button>
                        {frames.data && (
                          <>
                            <a
                              href={frames.data.zipUrl}
                              download
                              className="inline-flex items-center gap-2 rounded-lg bg-fg px-3 py-2 text-xs font-medium text-canvas"
                            >
                              <ArrowDownToLine size={14} /> {t("Download frames")}
                            </a>
                            <Button
                              disabled={dropFrames.isPending}
                              onClick={() => dropFrames.mutate()}
                              aria-label={t("Delete frames")}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                      {frameProblem && (
                        <p role="alert" className="mt-2 text-xs text-danger">
                          {frameProblem}
                        </p>
                      )}
                      {frames.data && (
                        <>
                          <p className="mt-3 text-xs text-fg-secondary">
                            {t("{count} frames · {width}×{height} · ", {
                              count: frames.data.count,
                              width: frames.data.width,
                              height: frames.data.height,
                            })}
                            {frames.data.format.toUpperCase()} ·{" "}
                            {(frames.data.sizeBytes / 1024 / 1024).toFixed(1)}{" "}
                            {t("MB · {fps} fps", { fps: frames.data.fps })}
                          </p>
                          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                            {frames.data.frameUrls
                              .filter(
                                (_, i) =>
                                  i %
                                    Math.max(
                                      1,
                                      Math.floor((frames.data as VideoFrameSet).count / 8),
                                    ) ===
                                  0,
                              )
                              .slice(0, 8)
                              .map((url, i) => (
                                <img
                                  key={url}
                                  src={url}
                                  alt={t("Frame sample {i}", { i: i + 1 })}
                                  loading="lazy"
                                  className="h-14 w-auto shrink-0 rounded border border-border-default"
                                />
                              ))}
                          </div>
                          <p className="mt-2 text-[11px] text-fg-muted">
                            {t(
                              "Numbered {code} with a poster and {code2} — the shape a scroll-scrub canvas reads.",
                              {
                                code: <code>frame_0001.{frameExtensions[frames.data.format]}</code>,
                                code2: <code>manifest.json</code>,
                              },
                            )}
                          </p>
                        </>
                      )}
                    </section>
                  )}
                </div>
              )}
            </section>
            {!current && (
              <div className="grid gap-3 sm:grid-cols-3">
                {examples.map((example, i) => (
                  <button
                    type="button"
                    key={example.title}
                    onClick={() => setPrompt(example.prompt)}
                    className="rounded-xl border border-border-default bg-surface p-4 text-left transition-colors hover:border-border-strong"
                  >
                    <span className="text-2xs tracking-widest text-fg-muted">
                      {t("SCENE 0")}
                      {i + 1}
                    </span>
                    <h3 className="mt-3 text-sm font-medium text-fg">{example.title}</h3>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                      {example.prompt}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-fg-secondary">
                      {t("Try this idea")} <ArrowUpRight size={12} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <section aria-label={t("Video library")} className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-fg">{t("Your films")}</h2>
              <p className="mt-1 text-xs text-fg-muted">
                {t("Private, saved, and ready to revisit.")}
              </p>
            </div>
            <span className="text-xs text-fg-muted">
              {t("{entrieCount} loaded", { entrieCount: entries.length })}
            </span>
          </div>
          {history.isPending ? (
            <Spinner />
          ) : history.isError ? (
            <p role="alert" className="text-sm text-danger">
              {history.error.message}
            </p>
          ) : !entries.length ? (
            <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-sm text-fg-muted">
              {t("Your first video will begin this collection.")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => {
                    setParams({ video: entry.id });
                    setConfirmDelete(false);
                  }}
                  className={`overflow-hidden rounded-xl border bg-surface text-left transition-colors ${current?.id === entry.id ? "border-fg" : "border-border-default hover:border-border-strong"}`}
                >
                  <div className="relative grid aspect-video place-items-center bg-canvas text-fg-muted">
                    {/* A frame from the finished clip is the truest thumbnail;
                          fall back to the starting image, then to the icon for
                          work that has not produced anything yet. */}
                    {entry.asset ? (
                      <img
                        src={entry.asset.posterUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : entry.reference ? (
                      <img
                        src={entry.reference.url}
                        alt=""
                        className="h-full w-full object-cover opacity-50"
                        loading="lazy"
                      />
                    ) : (
                      <Film size={25} strokeWidth={1.2} />
                    )}
                    <span className="absolute left-2 top-2 rounded bg-surface/90 px-1.5 py-1 text-2xs">
                      {entry.asset
                        ? t("Video")
                        : entry.reference
                          ? t("Starting image")
                          : t("Video")}
                    </span>
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-2xs text-white">
                      {entry.asset
                        ? `${entry.asset.durationSeconds.toFixed(1)}s`
                        : `${entry.input.durationSeconds}s`}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-xs leading-relaxed text-fg-secondary">
                      {entry.input.prompt}
                    </p>
                    <p className="mt-2 text-2xs text-fg-muted">{states[entry.status]}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {history.hasNextPage && (
            <div className="mt-5 text-center">
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t("Load more videos")}
              </Button>
            </div>
          )}
        </section>
      </PageBody>
    </AppShell>
  );
}
