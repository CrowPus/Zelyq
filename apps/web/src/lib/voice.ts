const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

export function preferredRecordingMimeType(
  supports: (mimeType: string) => boolean = MediaRecorder.isTypeSupported.bind(MediaRecorder),
): string | undefined {
  return RECORDING_MIME_TYPES.find((mimeType) => supports(mimeType));
}

export function insertTranscript(
  draft: string,
  transcript: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursor: number } {
  const text = transcript.trim();
  if (!text) return { value: draft, cursor: selectionStart };

  const start = Math.max(0, Math.min(selectionStart, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${prefix}${text}${suffix}`;
  return { value: `${before}${inserted}${after}`, cursor: start + inserted.length };
}
