import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ImageGeneration,
  type ImageGenerationInput,
  type ImageProviderId,
  imageProviderCatalog,
  isImageJobActive,
  maxImageReferenceBytes,
  maxImageReferences,
  randomUUID,
} from "@zelyq/core";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bot,
  Check,
  ImagePlus,
  Images,
  LockKeyhole,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  Badge,
  Button,
  NativeSelect,
  PageBody,
  PageHeader,
  Spinner,
  Tabs,
  Textarea,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";
import { formatDateParts, formatNumber } from "../lib/format";
import { t } from "../lib/i18n";
import { useTeamPaths } from "../lib/routes";

const examples = [
  {
    title: t("Product photography"),
    detail: t("Light, texture, and a little drama."),
    prompt: t(
      "An editorial product photograph of an amber glass perfume bottle on warm travertine, late afternoon sunlight casting long shadows, a single olive branch, restrained composition, tactile natural textures, no text.",
    ),
  },
  {
    title: t("An imagined world"),
    detail: t("Give an impossible place a real atmosphere."),
    prompt: t(
      "A tiny botanical library floating above a sea of clouds, glass walls glowing warmly at blue hour, overflowing plants, cinematic wide composition, intricate architectural details, dreamy but photorealistic, no text.",
    ),
  },
  {
    title: t("Something illustrated"),
    detail: t("Make a character with a story to tell."),
    prompt: t(
      "A charming hand-painted illustration of a fox running a little flower shop, loose gouache brushwork on textured ivory paper, terracotta and sage palette, expressive character, storybook composition, no text.",
    ),
  },
];
const sizeLabels = {
  "1024x1024": t("Square · 1:1"),
  "1536x1024": t("Landscape · 3:2"),
  "1024x1536": t("Portrait · 2:3"),
};
const statusLabels = {
  queued: t("Waiting to generate"),
  generating: t("Creating your image"),
  saving: t("Saving your image"),
  succeeded: t("Ready"),
  failed: t("Generation failed"),
  unknown: t("Result unconfirmed"),
};
/** Layout only: the look comes from the shared controls. */
const controlClass = "mt-2 w-full";
const ratios: Array<{
  value: ImageGenerationInput["size"];
  label: string;
  shape: string;
}> = [
  { value: "1024x1024", label: "1:1", shape: "aspect-square w-7" },
  { value: "1536x1024", label: "3:2", shape: "aspect-[3/2] w-8" },
  { value: "1024x1536", label: "2:3", shape: "aspect-[2/3] w-5" },
];
type UploadedReference = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  url: string;
};

async function referenceFromFile(file: File): Promise<UploadedReference> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error(t("Use PNG, JPEG, or WebP reference images."));
  if (file.size > maxImageReferenceBytes)
    throw new Error(t("Reference images must be 8 MB or smaller."));
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("Could not read that reference image.")));
    reader.readAsDataURL(file);
  });
  return {
    id: randomUUID(),
    name: file.name,
    mimeType: file.type as UploadedReference["mimeType"],
    data: dataUrl.split(",", 2)[1] ?? "",
    url: URL.createObjectURL(file),
  };
}

export function ImageStudioPage() {
  const paths = useTeamPaths();
  // Studio and the model list use the team's own AI keys first.
  const { team: activeTeam } = useActiveTeam();
  const { user } = useSession();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageGenerationInput["size"]>("1024x1024");
  const [providerId, setProviderId] = useState<ImageProviderId | null>(null);
  const [quality, setQuality] = useState<ImageGenerationInput["quality"]>("medium");
  const [references, setReferences] = useState<UploadedReference[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const submission = useRef<ImageGenerationInput | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Each team has its own Studio: what was made in another team is not shown here.
  const historyKey = ["image-history", user?.id, activeTeam?.id];
  const capabilities = useQuery({
    queryKey: ["image-capabilities", user?.id, activeTeam?.id],
    queryFn: () => api.imageCapabilities(activeTeam?.id),
    refetchOnMount: "always",
  });
  const selectedProviderId = providerId ?? capabilities.data?.provider ?? "openai";
  const provider = capabilities.data?.providers.find((entry) => entry.id === selectedProviderId);
  const supportedQualities = provider?.qualities ?? ["medium"];
  const effectiveQuality = supportedQualities.includes(quality) ? quality : "medium";
  const supportsReferences = Boolean(provider?.referenceImages);
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.imageHistory(pageParam, activeTeam?.id),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.generations.some((job) => isImageJobActive(job.status)),
      )
        ? 2500
        : false,
  });
  const detail = useQuery({
    queryKey: ["image-generation", user?.id, selectedId],
    queryFn: () => api.imageGeneration(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: (query) =>
      query.state.data && isImageJobActive(query.state.data.generation.status) ? 2000 : false,
  });
  const generations = history.data?.pages.flatMap((page) => page.generations) ?? [];
  const selected = selectedId ? detail.data?.generation : generations[0];
  const active =
    generations.some((job) => isImageJobActive(job.status)) ||
    Boolean(selected && isImageJobActive(selected.status));
  const generate = useMutation({
    mutationFn: (input: ImageGenerationInput) => api.generateImage(input, activeTeam?.id),
    onSuccess: ({ generation }) => {
      submission.current = null;
      client.setQueryData(["image-generation", user?.id, generation.id], { generation });
      setParams({ image: generation.id });
      void client.invalidateQueries({ queryKey: historyKey });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: historyKey });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteImage,
    onSuccess: (_, id) => {
      setConfirmDelete(null);
      if (id === selectedId) setParams({});
      client.removeQueries({ queryKey: ["image-generation", user?.id, id] });
      void client.invalidateQueries({ queryKey: historyKey });
    },
  });

  function submit() {
    const previous = submission.current;
    const text = prompt.trim();
    const input =
      previous &&
      previous.prompt === text &&
      previous.size === size &&
      previous.quality === effectiveQuality &&
      previous.provider === selectedProviderId &&
      JSON.stringify(previous.references ?? []) ===
        JSON.stringify(references.map(({ mimeType, data }) => ({ mimeType, data })))
        ? previous
        : {
            provider: selectedProviderId,
            prompt: text,
            size,
            quality: effectiveQuality,
            references: references.map(({ mimeType, data }) => ({ mimeType, data })),
            idempotencyKey: randomUUID(),
          };
    submission.current = input;
    generate.mutate(input);
  }
  function reuse(job: ImageGeneration) {
    setProviderId(job.provider);
    setPrompt(job.prompt);
    setSize(job.size);
    setQuality(job.quality);
    generate.reset();
    submission.current = null;
    promptRef.current?.focus();
  }
  async function addReferences(files: FileList | null) {
    if (!files?.length) return;
    setReferenceError(null);
    try {
      const openSlots = maxImageReferences - references.length;
      const next = await Promise.all([...files].slice(0, openSlots).map(referenceFromFile));
      setReferences((current) => [...current, ...next].slice(0, maxImageReferences));
      if (files.length > openSlots)
        setReferenceError(t("Use up to {maxImageReferences} references.", { maxImageReferences }));
    } catch (error) {
      setReferenceError(
        error instanceof Error ? error.message : t("Could not add that reference."),
      );
    }
  }
  function removeReference(id: string) {
    setReferences((current) => {
      const removed = current.find((reference) => reference.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((reference) => reference.id !== id);
    });
    submission.current = null;
  }

  return (
    <AppShell crumbs={[{ label: t("Studio") }, { label: t("Image") }]}>
      <PageBody>
        <PageHeader
          title={t("Studio")}
          description={t(
            "Make images and short videos for your apps. What you make stays in the team’s private library.",
          )}
          meta={
            <>
              <Badge tone="neutral">
                <LockKeyhole size={11} className="mr-1" /> {t("Private library")}
              </Badge>
              {provider?.modelLabel && (
                <span className="text-xs text-fg-muted">
                  {t("Model: {modelLabel}", { modelLabel: provider.modelLabel })}
                </span>
              )}
            </>
          }
          tabs={
            <Tabs
              label={t("Studio")}
              value={"image" as "image" | "video"}
              items={[
                { id: "image", label: t("Image"), to: paths.studioImage },
                { id: "video", label: t("Video"), to: paths.studioVideo },
              ]}
            />
          }
        />

        {capabilities.isError && (
          <p role="alert" className="mb-5 text-sm text-danger">
            {t("Could not load image settings. ")}
            <button type="button" className="underline" onClick={() => void capabilities.refetch()}>
              {t("Try again")}
            </button>
          </p>
        )}
        {capabilities.data && !provider?.configured && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface p-4 text-sm">
            <div>
              <p className="font-medium text-fg">{t("Connect an image model to get started")}</p>
              <p className="mt-1 text-fg-secondary">
                {user?.instanceRole === "admin"
                  ? t(
                      "Add this provider’s image API key in Server admin. Image generation is billed to that key.",
                    )
                  : t("Ask your administrator to add an image API key in Server admin.")}
              </p>
            </div>
            {user?.instanceRole === "admin" && (
              <Link
                to="/admin#image-generation"
                className="inline-flex items-center gap-2 font-medium text-fg underline underline-offset-4"
              >
                {t("Open Settings")} <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="rounded-2xl border border-border-default bg-surface p-5 sm:p-6"
          >
            <div className="mb-5">
              <label htmlFor="image-provider" className="text-xs font-medium text-fg-secondary">
                {t("Image provider")}
              </label>
              <NativeSelect
                id="image-provider"
                className={controlClass}
                value={selectedProviderId}
                onChange={(event) => {
                  setProviderId(event.target.value as ImageProviderId);
                  generate.reset();
                  submission.current = null;
                }}
              >
                {Object.entries(imageProviderCatalog).map(([id, entry]) => (
                  <option key={id} value={id}>
                    {entry.label}
                    {capabilities.data?.providers.find((item) => item.id === id)?.configured
                      ? ""
                      : t(" · not configured")}
                  </option>
                ))}
              </NativeSelect>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <span className="rounded-md border border-border-default bg-canvas px-2.5 py-2 text-fg-secondary">
                  {provider?.referenceImages ? t("References enabled") : t("Prompt only")}
                </span>
                <span className="rounded-md border border-border-default bg-canvas px-2.5 py-2 text-fg-secondary">
                  {provider?.modelLabel ?? t("Choose a model")}
                </span>
              </div>
              {user?.instanceRole === "admin" && (
                <Link
                  to="/admin#image-generation"
                  className="mt-2 inline-block text-xs text-fg-secondary underline underline-offset-4"
                >
                  {t("Image generation settings")}
                </Link>
              )}
            </div>
            <label htmlFor="image-prompt" className="text-sm font-semibold text-fg">
              {t("Prompt")}
            </label>
            <Textarea
              ref={promptRef}
              id="image-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={8000}
              required
              rows={7}
              placeholder={t(
                "A sunlit room overlooking the sea, soft linen curtains, warm film grain…",
              )}
              className={`${controlClass} min-h-44 resize-y text-base leading-relaxed`}
            />
            <div className="mt-2 flex justify-between gap-3 text-xs text-fg-muted">
              <span>{t("Try a subject, a setting, and a style.")}</span>
              <span>{formatNumber(prompt.length)}/8,000</span>
            </div>
            <div className="mt-6">
              <p className="text-xs font-medium text-fg-secondary">{t("Aspect ratio")}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {ratios.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setSize(ratio.value)}
                    className={`flex h-16 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition-colors ${
                      size === ratio.value
                        ? "border-primary bg-primary/10 text-fg"
                        : "border-border-default bg-canvas text-fg-secondary hover:border-border-strong"
                    }`}
                  >
                    <span className={`${ratio.shape} rounded-sm border border-current`} />
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="image-quality" className="text-xs font-medium text-fg-secondary">
                {t("Quality")}
                <NativeSelect
                  id="image-quality"
                  disabled={supportedQualities.length === 1}
                  className={controlClass}
                  value={effectiveQuality}
                  onChange={(event) => setQuality(event.target.value as typeof quality)}
                >
                  {supportedQualities.map((value) => (
                    <option key={value} value={value}>
                      {supportedQualities.length === 1
                        ? t("Standard · 1K")
                        : value === "low"
                          ? t("Quick draft")
                          : value === "medium"
                            ? t("Balanced")
                            : t("High detail")}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="image-references" className="text-xs font-medium text-fg-secondary">
                  {t("Reference images")}
                </label>
                <span className="text-xs text-fg-muted">
                  {references.length}/{maxImageReferences}
                </span>
              </div>
              <label
                htmlFor="image-references"
                className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
                  supportsReferences
                    ? "border-border-default bg-canvas text-fg-secondary hover:border-border-strong"
                    : "border-border-default bg-canvas text-fg-muted opacity-60"
                }`}
              >
                <Images size={22} strokeWidth={1.5} />
                <span className="mt-2 text-sm">
                  {supportsReferences
                    ? t("Upload style or subject references")
                    : t("Not available for this provider")}
                </span>
                <span className="mt-1 text-xs text-fg-muted">
                  {t("PNG, JPEG, or WebP up to 8 MB")}
                </span>
              </label>
              <input
                id="image-references"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={!supportsReferences || references.length >= maxImageReferences}
                className="sr-only"
                onChange={(event) => {
                  void addReferences(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              {references.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {references.map((reference) => (
                    <div
                      key={reference.id}
                      className="group relative overflow-hidden rounded-lg border border-border-default bg-canvas"
                    >
                      <img
                        src={reference.url}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                      <button
                        type="button"
                        title={t("Remove reference")}
                        aria-label={t("Remove reference")}
                        onClick={() => removeReference(reference.id)}
                        className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 text-fg-secondary hover:text-danger"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {supportsReferences && references.length < maxImageReferences && (
                    <label
                      htmlFor="image-references"
                      className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-border-default bg-canvas text-fg-muted hover:border-border-strong"
                      title={t("Add reference")}
                    >
                      <Plus size={18} />
                    </label>
                  )}
                </div>
              )}
              {referenceError && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {referenceError}
                </p>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fg-muted">
              {selectedProviderId === "openai"
                ? t("OpenAI can generate from text or remix your references.")
                : selectedProviderId === "google"
                  ? t("Google can use references and returns native image dimensions.")
                  : t("xAI currently generates from the prompt only.")}
            </p>
            <Button
              type="submit"
              variant="primary"
              className="mt-6 h-11 w-full rounded-lg"
              disabled={
                !provider?.configured ||
                !prompt.trim() ||
                active ||
                generate.isPending ||
                (references.length > 0 && !supportsReferences)
              }
              icon={generate.isPending || active ? <Spinner /> : <Sparkles size={16} />}
            >
              {generate.isPending
                ? t("Submitting…")
                : active
                  ? t("Generation in progress")
                  : generate.isError
                    ? t("Retry request")
                    : t("Generate image")}
            </Button>
            {generate.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {generate.error.message}
              </p>
            )}
            <p className="mt-3 text-center text-xs text-fg-muted">
              {t("Your images are only visible to you.")}
            </p>
          </form>

          <section
            aria-label={t("Image preview")}
            className="min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border-default px-5 py-3 text-xs text-fg-secondary">
              <span>{t("Canvas")}</span>
              <span>{selected ? statusLabels[selected.status] : ""}</span>
            </div>
            {selectedId && detail.isError ? (
              <div
                role="alert"
                className="grid min-h-96 place-content-center gap-3 p-8 text-center text-sm text-danger"
              >
                <p>{detail.error.message}</p>
                <Button onClick={() => void detail.refetch()}>{t("Try again")}</Button>
              </div>
            ) : selectedId && detail.isLoading ? (
              <div className="grid min-h-96 place-items-center">
                <Spinner />
              </div>
            ) : selected ? (
              <>
                <div className="flex min-h-[360px] items-center justify-center bg-canvas p-5 sm:min-h-[440px]">
                  {selected.asset ? (
                    <img
                      key={selected.id}
                      src={selected.asset.url}
                      alt={selected.prompt}
                      className="max-h-[620px] max-w-full rounded-lg object-contain"
                    />
                  ) : (
                    <div role="status" aria-live="polite" className="max-w-sm p-6 text-center">
                      {isImageJobActive(selected.status) ? (
                        <>
                          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-border-default bg-surface">
                            <Spinner />
                          </div>
                          <h2 className="text-lg font-medium text-fg">
                            {statusLabels[selected.status]}
                          </h2>
                          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                            {t(
                              "Good details take a moment. You can leave this page; your image will be saved here.",
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <ImagePlus className="mx-auto mb-4 text-fg-muted" size={32} />
                          <h2 className="text-lg font-medium text-fg">
                            {statusLabels[selected.status]}
                          </h2>
                          <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
                            {selected.error}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="border-t border-border-default p-5">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-secondary">
                    {selected.prompt}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="mr-auto text-xs text-fg-muted">
                      {imageProviderCatalog[selected.provider].label} ·{" "}
                      {selected.asset
                        ? `${selected.asset.width}×${selected.asset.height}`
                        : sizeLabels[selected.size]}
                      {selected.referenceCount > 0
                        ? t(" · {referenceCount, plural, one {# reference} other {# references}}", {
                            referenceCount: selected.referenceCount,
                          })
                        : ""}
                    </span>
                    <Button size="sm" onClick={() => reuse(selected)} icon={<RotateCw size={13} />}>
                      {t("Use prompt")}
                    </Button>
                    {selected.asset && (
                      <a
                        href={`${selected.asset.url}?download=1`}
                        download
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-fg"
                      >
                        <ArrowDownToLine size={13} /> {t("Download PNG")}
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="relative flex min-h-[440px] items-center justify-center overflow-hidden bg-canvas p-8">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute size-72 rounded-full border border-border-default opacity-50"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute size-96 rounded-full border border-border-default opacity-30"
                />
                <div className="relative max-w-xs text-center">
                  <div className="mx-auto mb-6 grid size-16 rotate-[-8deg] place-items-center rounded-2xl border border-border-default bg-surface">
                    <ImagePlus size={27} strokeWidth={1.3} className="text-fg-secondary" />
                  </div>
                  <h2 className="text-xl font-medium tracking-tight text-fg">
                    {t("Nothing made yet")}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                    {t("Describe an image on the left and it appears here.")}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        {!generations.length && !history.isLoading && (
          <section className="mt-8">
            <h2 className="mb-4 text-sm font-medium text-fg">{t("A little inspiration")}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {examples.map((example, index) => (
                <button
                  key={example.title}
                  type="button"
                  onClick={() => {
                    setPrompt(example.prompt);
                    promptRef.current?.focus();
                  }}
                  className="group rounded-xl border border-border-default bg-surface p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <span className="text-xs text-fg-muted">0{index + 1}</span>
                  <p className="mt-4 flex items-center justify-between text-sm font-medium text-fg">
                    {example.title}
                    <ArrowUpRight size={15} className="text-fg-muted" />
                  </p>
                  <p className="mt-1.5 text-xs text-fg-secondary">{example.detail}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10" aria-label={t("Image history")}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-medium tracking-tight text-fg">{t("Your creations")}</h2>
            <span className="text-xs text-fg-muted">{t("Saved as you create")}</span>
          </div>
          {history.isLoading && <Spinner />}
          {history.isError && (
            <p role="alert" className="mb-4 text-sm text-danger">
              {t("Could not load your library. ")}
              <button type="button" className="underline" onClick={() => void history.refetch()}>
                {t("Try again")}
              </button>
            </p>
          )}
          {remove.isError && (
            <p role="alert" className="mb-4 text-sm text-danger">
              {remove.error.message}
            </p>
          )}
          {!generations.length && !history.isLoading && !history.isError && (
            <p className="rounded-xl border border-dashed border-border-default p-7 text-center text-sm text-fg-muted">
              {t("Your first image is waiting to happen.")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {generations.map((job) => (
              <article
                key={job.id}
                className={`overflow-hidden rounded-xl border bg-surface ${selected?.id === job.id ? "border-primary" : "border-border-default"}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setParams({ image: job.id });
                    setConfirmDelete(null);
                  }}
                  aria-label={t("View image: {prompt}", { prompt: job.prompt })}
                  className="block w-full text-left"
                >
                  <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-canvas">
                    {job.asset ? (
                      <img
                        src={job.asset.url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex flex-col items-center gap-3 p-3 text-center text-xs text-fg-muted">
                        {isImageJobActive(job.status) ? <Spinner /> : <ImagePlus size={22} />}
                        {statusLabels[job.status]}
                      </span>
                    )}
                    {selected?.id === job.id && (
                      <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-fg">
                        <Check size={12} />
                      </span>
                    )}
                    {job.referenceCount > 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-1 text-2xs font-medium text-fg-secondary">
                        {t("{referenceCount} ref", { referenceCount: job.referenceCount })}
                      </span>
                    )}
                    {job.source === "agent" && (
                      <span
                        className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-surface/90 px-2 py-1 text-2xs font-medium text-fg-secondary"
                        title={
                          job.projectName
                            ? t("Made by the agent in {projectName}", {
                                projectName: job.projectName,
                              })
                            : t("Made by the agent")
                        }
                      >
                        <Bot size={10} />
                        {job.projectName || t("agent")}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 min-h-14 break-words px-3 pt-3 text-xs leading-relaxed text-fg-secondary">
                    {job.prompt}
                  </p>
                </button>
                <div className="flex flex-wrap items-center justify-between gap-1 px-3 pb-3 pt-2">
                  <span className="text-xs text-fg-muted">
                    {formatDateParts(job.createdAt, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {!isImageJobActive(job.status) &&
                    (confirmDelete === job.id ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(job.id)}
                        >
                          {t("Delete")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                          {t("Keep")}
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={t("Delete generation")}
                        title={t("Delete generation")}
                        onClick={() => setConfirmDelete(job.id)}
                        className="rounded p-1 text-fg-muted hover:bg-danger-subtle hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    ))}
                </div>
              </article>
            ))}
          </div>
          {history.hasNextPage && (
            <div className="mt-6 text-center">
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage ? t("Loading…") : t("Load more")}
              </Button>
            </div>
          )}
        </section>
      </PageBody>
    </AppShell>
  );
}
