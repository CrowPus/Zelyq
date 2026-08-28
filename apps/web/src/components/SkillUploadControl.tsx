import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { buildSkillUploadFiles } from "../lib/files";
import { Button } from "./ui";

/**
 * Upload a skill through Settings. Picks a whole folder (`webkitdirectory`,
 * not a single file — a skill is a directory, `SKILL.md` plus whatever it
 * carries underneath). Every selected
 * file's path is sent stripped of the folder name the browser always
 * prefixes, so the server sees exactly what a real `skills/<name>/`
 * directory would contain — `SKILL.md`, `references/whatever.md`, and so
 * on — never the picker's own folder name baked in as an extra path
 * segment.
 */
export function SkillUploadControl({ onUploaded }: { onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<{ name: string; fileCount: number } | null>(null);

  // Not a real HTML attribute React's own types know about — set on the
  // element directly rather than reaching for a JSX-level type override.
  useEffect(() => {
    if (inputRef.current) {
      (inputRef.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    }
  }, []);

  const upload = useMutation({
    // `File[]`, not `FileList` — a `FileList` is a *live* view onto the input's
    // current selection. `onChange` below resets `event.target.value` right
    // after calling `mutate`, to allow re-selecting the same folder twice in a
    // row, and that reset clears `.files` immediately. `mutationFn` runs later
    // than that reset (`mutate` defers it, at minimum a microtask), so reading
    // a `FileList` here saw an already-emptied selection — every upload sent
    // zero files and failed schema validation before this was caught live.
    mutationFn: async (files: File[]) => {
      const payloadFiles = await buildSkillUploadFiles(files);
      return api.uploadSkill({ files: payloadFiles });
    },
    onSuccess: ({ skill }) => {
      setUploaded({ name: skill.name, fileCount: skill.fileCount });
      onUploaded?.();
    },
  });

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          setUploaded(null);
          // Captured now, before the reset below — see the note on
          // `mutationFn` above for why this can't be the live FileList.
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) upload.mutate(files);
          event.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<GraduationCap size={13} strokeWidth={1.75} />}
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
      >
        {upload.isPending ? "Uploading…" : "Upload a skill"}
      </Button>

      {upload.isError && (
        <p className="mt-1.5 flex items-start gap-1 text-2xs text-danger">
          <CircleAlert size={12} strokeWidth={1.75} className="mt-px shrink-0" />
          {describeUploadError(upload.error)}
        </p>
      )}
      {uploaded && !upload.isPending && !upload.isError && (
        <p className="mt-1.5 flex items-start gap-1 text-2xs text-success">
          <CircleCheck size={12} strokeWidth={1.75} className="mt-px shrink-0" />
          Uploaded "{uploaded.name}" ({uploaded.fileCount} file{uploaded.fileCount === 1 ? "" : "s"}
          ). Restart the agent to activate it — uploading never changes what a running turn can
          already reach.
        </p>
      )}
    </div>
  );
}

/** `error.message` alone is the generic "Request validation failed" for a
 * schema rejection — the actual field and reason only exist in `details`.
 * Showing the first one is what would have made this bug obvious the
 * moment it happened live, instead of needing to be reproduced by hand. */
function describeUploadError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not upload that skill.";
  const issues = error.details?.issues;
  const first = Array.isArray(issues) ? (issues[0] as { path?: string; message?: string }) : null;
  if (first?.message)
    return `${error.message}: ${first.path ? `${first.path} — ` : ""}${first.message}`;
  return error.message;
}
