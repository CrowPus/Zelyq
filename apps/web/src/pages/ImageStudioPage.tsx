import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ImageGeneration,
  type ImageGenerationInput,
  type ImageProviderId,
  imageProviderCatalog,
  isImageJobActive,
  maxImageReferenceBytes,
  maxImageReferences,
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
import { Button, Spinner } from "../components/ui";
import { useSession } from "../hooks/useSession";
import { api } from "../lib/api";

const examples = [
  {
    title: "Product photography",
    detail: "Light, texture, and a little drama.",
    prompt:
      "An editorial product photograph of an amber glass perfume bottle on warm travertine, late afternoon sunlight casting long shadows, a single olive branch, restrained composition, tactile natural textures, no text.",
  },
  {
    title: "An imagined world",
    detail: "Give an impossible place a real atmosphere.",
    prompt:
      "A tiny botanical library floating above a sea of clouds, glass walls glowing warmly at blue hour, overflowing plants, cinematic wide composition, intricate architectural details, dreamy but photorealistic, no text.",
  },
  {
    title: "Something illustrated",
    detail: "Make a character with a story to tell.",
    prompt:
      "A charming hand-painted illustration of a fox running a little flower shop, loose gouache brushwork on textured ivory paper, terracotta and sage palette, expressive character, storybook composition, no text.",
  },
];
const sizeLabels = {
  "1024x1024": "Square · 1:1",
  "1536x1024": "Landscape · 3:2",
  "1024x1536": "Portrait · 2:3",
};
const statusLabels = {
  queued: "Waiting to generate",
  generating: "Creating your image",
  saving: "Saving your image",
  succeeded: "Ready",
  failed: "Generation failed",
  unknown: "Result unconfirmed",
};
const controlClass =
  "mt-2 w-full rounded-lg border border-border-default bg-canvas px-3 py-2.5 text-sm text-fg outline-none focus:border-border-strong focus:ring-2 focus:ring-primary/20 disabled:opacity-50";
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
    throw new Error("Use PNG, JPEG, or WebP reference images.");
  if (file.size > maxImageReferenceBytes)
    throw new Error("Reference images must be 8 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that reference image."));
    reader.readAsDataURL(file);
  });
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type as UploadedReference["mimeType"],
    data: dataUrl.split(",", 2)[1] ?? "",
    url: URL.createObjectURL(file),
  };
}

export function ImageStudioPage() {
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
  const historyKey = ["image-history", user?.id];
  const capabilities = useQuery({
    queryKey: ["image-capabilities", user?.id],
    queryFn: api.imageCapabilities,
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
    queryFn: ({ pageParam }) => api.imageHistory(pageParam),
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
    mutationFn: (input: ImageGenerationInput) => api.generateImage(input),
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
            idempotencyKey: crypto.randomUUID(),
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
        setReferenceError(`Use up to ${maxImageReferences} references.`);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : "Could not add that reference.");
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
    <AppShell
      crumbs={[{ label: "Image Studio" }]}
      actions={
        <span className="hidden items-center gap-1.5 pr-2 text-xs text-fg-muted sm:flex">
          <LockKeyhole size={12} /> Private library
        </span>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-fg-muted">
                <Sparkles size={14} /> A space for imagination
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
                Image Studio<span className="text-fg-muted">.</span>
              </h1>
              <p className="mt-3 text-sm text-fg-secondary">
                Describe what you see in your mind. Make it something you can use.
              </p>
            </div>
            <span className="rounded-full border border-border-default px-3 py-1.5 text-xs text-fg-secondary">
              {provider?.modelLabel ?? "Image generation"}
            </span>
          </header>

          {capabilities.isError && (
            <p role="alert" className="mb-5 text-sm text-danger">
              Could not load image settings.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void capabilities.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {capabilities.data && !provider?.configured && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface p-4 text-sm">
              <div>
                <p className="font-medium text-fg">Connect an image model to get started</p>
                <p className="mt-1 text-fg-secondary">
                  {user?.instanceRole === "admin"
                    ? "Add this provider’s image API key in Settings. Image generation is billed to that key."
                    : "Ask your administrator to add an Image Studio API key in Settings."}
                </p>
              </div>
              {user?.instanceRole === "admin" && (
                <Link
                  to="/settings#image-generation"
                  className="inline-flex items-center gap-2 font-medium text-fg underline underline-offset-4"
                >
                  Open Settings <ArrowUpRight size={14} />
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
              className="rounded-2xl border border-border-default bg-surface p-5 shadow-sm sm:p-6"
            >
              <div className="mb-5">
                <label htmlFor="image-provider" className="text-xs font-medium text-fg-secondary">
                  Image provider
                </label>
                <select
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
                        : " · not configured"}
                    </option>
                  ))}
                </select>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-md border border-border-default bg-canvas px-2.5 py-2 text-fg-secondary">
                    {provider?.referenceImages ? "References enabled" : "Prompt only"}
                  </span>
                  <span className="rounded-md border border-border-default bg-canvas px-2.5 py-2 text-fg-secondary">
                    {provider?.modelLabel ?? "Choose a model"}
                  </span>
                </div>
                {user?.instanceRole === "admin" && (
                  <Link
                    to="/settings#image-generation"
                    className="mt-2 inline-block text-xs text-fg-secondary underline underline-offset-4"
                  >
                    Image generation settings
                  </Link>
                )}
              </div>
              <label htmlFor="image-prompt" className="text-sm font-semibold text-fg">
                Your imagination, in words
              </label>
              <textarea
                ref={promptRef}
                id="image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={8000}
                required
                rows={7}
                placeholder="A sunlit room overlooking the sea, soft linen curtains, warm film grain…"
                className={`${controlClass} min-h-44 resize-y leading-relaxed`}
              />
              <div className="mt-2 flex justify-between gap-3 text-xs text-fg-muted">
                <span>Try a subject, a setting, and a style.</span>
                <span>{prompt.length.toLocaleString()}/8,000</span>
              </div>
              <div className="mt-6">
                <p className="text-xs font-medium text-fg-secondary">Aspect ratio</p>
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
                  Quality
                  <select
                    id="image-quality"
                    disabled={supportedQualities.length === 1}
                    className={controlClass}
                    value={effectiveQuality}
                    onChange={(event) => setQuality(event.target.value as typeof quality)}
                  >
                    {supportedQualities.map((value) => (
                      <option key={value} value={value}>
                        {supportedQualities.length === 1
                          ? "Standard · 1K"
                          : value === "low"
                            ? "Quick draft"
                            : value === "medium"
                              ? "Balanced"
                              : "High detail"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="image-references"
                    className="text-xs font-medium text-fg-secondary"
                  >
                    Reference images
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
                      ? "Upload style or subject references"
                      : "Not available for this provider"}
                  </span>
                  <span className="mt-1 text-xs text-fg-muted">PNG, JPEG, or WebP up to 8 MB</span>
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
                          title="Remove reference"
                          aria-label="Remove reference"
                          onClick={() => removeReference(reference.id)}
                          className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 text-fg-secondary shadow-sm hover:text-danger"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {supportsReferences && references.length < maxImageReferences && (
                      <label
                        htmlFor="image-references"
                        className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-border-default bg-canvas text-fg-muted hover:border-border-strong"
                        title="Add reference"
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
                  ? "OpenAI can generate from text or remix your references."
                  : selectedProviderId === "google"
                    ? "Google can use references and returns native image dimensions."
                    : "xAI currently generates from the prompt only."}
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
                  ? "Submitting…"
                  : active
                    ? "Generation in progress"
                    : generate.isError
                      ? "Retry request"
                      : "Generate image"}
              </Button>
              {generate.isError && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {generate.error.message}
                </p>
              )}
              <p className="mt-3 text-center text-xs text-fg-muted">
                Your images are only visible to you.
              </p>
            </form>

            <section
              aria-label="Image preview"
              className="min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface"
            >
              <div className="flex items-center justify-between border-b border-border-default px-5 py-3 text-xs text-fg-secondary">
                <span>Canvas</span>
                <span>
                  {selected ? statusLabels[selected.status] : "Made from your imagination"}
                </span>
              </div>
              {selectedId && detail.isError ? (
                <div
                  role="alert"
                  className="grid min-h-96 place-content-center gap-3 p-8 text-center text-sm text-danger"
                >
                  <p>{detail.error.message}</p>
                  <Button onClick={() => void detail.refetch()}>Try again</Button>
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
                        className="max-h-[620px] max-w-full rounded-lg object-contain shadow-sm"
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
                              Good details take a moment. You can leave this page; your image will
                              be saved here.
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
                          ? ` · ${selected.referenceCount} reference${selected.referenceCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => reuse(selected)}
                        icon={<RotateCw size={13} />}
                      >
                        Use prompt
                      </Button>
                      {selected.asset && (
                        <a
                          href={`${selected.asset.url}?download=1`}
                          download
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-fg"
                        >
                          <ArrowDownToLine size={13} /> Download PNG
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
                    <div className="mx-auto mb-6 grid size-16 rotate-[-8deg] place-items-center rounded-2xl border border-border-default bg-surface shadow-sm">
                      <ImagePlus size={27} strokeWidth={1.3} className="text-fg-secondary" />
                    </div>
                    <h2 className="text-xl font-medium tracking-tight text-fg">
                      Every image starts with an idea.
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                      A product shot. An impossible landscape. Something nobody has seen before.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>

          {!generations.length && !history.isLoading && (
            <section className="mt-8">
              <h2 className="mb-4 text-sm font-medium text-fg">A little inspiration</h2>
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

          <section className="mt-10" aria-label="Image history">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-medium tracking-tight text-fg">Your creations</h2>
              <span className="text-xs text-fg-muted">Saved as you create</span>
            </div>
            {history.isLoading && <Spinner />}
            {history.isError && (
              <p role="alert" className="mb-4 text-sm text-danger">
                Could not load your library.{" "}
                <button type="button" className="underline" onClick={() => void history.refetch()}>
                  Try again
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
                Your first image is waiting to happen.
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
                    aria-label={`View image: ${job.prompt}`}
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
                        <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-1 text-[10px] font-medium text-fg-secondary shadow-sm">
                          {job.referenceCount} ref
                        </span>
                      )}
                      {job.source === "agent" && (
                        <span
                          className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-surface/90 px-2 py-1 text-[10px] font-medium text-fg-secondary shadow-sm"
                          title={
                            job.projectName
                              ? `Made by the agent in ${job.projectName}`
                              : "Made by the agent"
                          }
                        >
                          <Bot size={10} />
                          {job.projectName || "agent"}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-2 min-h-14 break-words px-3 pt-3 text-xs leading-relaxed text-fg-secondary">
                      {job.prompt}
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center justify-between gap-1 px-3 pb-3 pt-2">
                    <span className="text-xs text-fg-muted">
                      {new Date(job.createdAt).toLocaleDateString(undefined, {
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
                            Delete
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label="Delete generation"
                          title="Delete generation"
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
                  {history.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
