import type { RuntimeDriver } from "@zelyq/runtime";

/**
 * A line only each template's untouched starting screen has. While one is
 * still there, nobody has built anything yet: the next request is the app's
 * first build, the one a person judges the product by.
 */
export const STARTER_MARKERS: ReadonlyArray<{ file: string; text: string }> = [
  { file: "src/App.tsx", text: "Your app starts here." },
  { file: "src/App.tsx", text: "Your backend is ready to build." },
  { file: "app/index.tsx", text: "Edit app/index.tsx and it reloads" },
];

/** Whether the project is still its template's starter (nothing built yet). */
export async function isStarterProject(
  runtime: RuntimeDriver,
  projectId: string,
): Promise<boolean> {
  const files = [...new Set(STARTER_MARKERS.map((marker) => marker.file))];
  for (const file of files) {
    const content = await runtime
      .readFile(projectId, file)
      .then((read) => (read.encoding === "utf8" ? read.content : null))
      .catch(() => null);
    if (!content) continue;
    if (STARTER_MARKERS.some((marker) => marker.file === file && content.includes(marker.text))) {
      return true;
    }
  }
  return false;
}
