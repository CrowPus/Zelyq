import { useEffect, useState } from "react";
import type { components } from "./lib/api/schema";

type Note = components["schemas"]["NoteOut"];
type Report = components["schemas"]["CsvReport"];

export default function App() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) throw new Error("Could not load saved notes.");
      setNotes(await response.json());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The backend is unavailable.");
      setNotes([]);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Could not save that note.");
      setDraft("");
      setNotes((current) => [data, ...(current ?? [])]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The backend is unavailable.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setUploadError("");
    setReport(null);
    try {
      if (file.size > 1_000_000) throw new Error("Choose a CSV file smaller than 1 MB.");
      const response = await fetch("/api/reports/csv", {
        method: "POST",
        body: file,
        headers: { "content-type": "text/csv" },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Could not process this file.");
      setReport(data);
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : "The backend is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="mb-4 text-sm font-medium text-indigo-600">React + Python</p>
      <h1 className="text-4xl font-semibold tracking-tight">Your backend is ready to build.</h1>
      <p className="mt-5 text-lg text-slate-600">
        This project already has its own database — nothing to set up. What you save below
        survives a refresh and a restart.
      </p>

      <section aria-labelledby="notes-heading" className="mt-10">
        <h2 id="notes-heading" className="text-lg font-semibold">
          Saved notes
        </h2>
        <form className="mt-3 flex gap-2" onSubmit={save}>
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
            aria-label="Note"
            placeholder="Write something and save it"
            maxLength={500}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-red-700">
            {error}
          </p>
        )}
        {notes === null ? (
          <p className="mt-4 text-slate-500">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="mt-4 text-slate-500">Nothing saved yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3">
                <p>{note.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(note.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="csv-heading" className="mt-12">
        <h2 id="csv-heading" className="text-lg font-semibold">
          Process a file in Python
        </h2>
        <label className="mt-3 block rounded-xl border border-slate-200 p-5">
          Choose a CSV file (up to 1 MB) — read in memory, not saved
          <input
            className="mt-3 block w-full text-sm"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>
        {busy && (
          <p role="status" className="mt-3">
            Analysing your file…
          </p>
        )}
        {uploadError && (
          <p role="alert" className="mt-3 text-red-700">
            {uploadError}
          </p>
        )}
        {report && (
          <section aria-label="CSV report" className="mt-4 rounded-xl bg-slate-50 p-5">
            <h3 className="font-semibold">
              {report.rows} data rows · {report.columns.length} columns
            </h3>
            <p className="mt-2 text-slate-600">{report.columns.join(", ")}</p>
          </section>
        )}
      </section>
    </main>
  );
}
