import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { fileToBase64 } from "../lib/files";
import { Button } from "./ui";

/**
 * Upload a skill through Settings — see `043` in the council notes. Picks
 * a whole folder (`webkitdirectory`, not a single file — a skill is a
 * directory, `SKILL.md` plus whatever it carries underneath, the same
 * shape `042` corrected to after shipping the wrong one). Every selected
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
    mutationFn: async (fileList: FileList) => {
      const files = Array.from(fileList);
      const rootFolder = files[0]?.webkitRelativePath.split("/")[0] ?? "";
      const payloadFiles = await Promise.all(
        files.map(async (file) => ({
          path: rootFolder ? file.webkitRelativePath.slice(rootFolder.length + 1) : file.name,
          data: await fileToBase64(file),
        })),
      );
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
          if (event.target.files?.length) upload.mutate(event.target.files);
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
          {upload.error instanceof ApiError ? upload.error.message : "Could not upload that skill."}
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
