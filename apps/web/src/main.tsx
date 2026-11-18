import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initialLanguage, loadLanguage } from "./lib/i18n";

// A new build replaces the hashed chunk files, so a tab opened before the
// deploy asks for chunks that no longer exist the first time it lazy-loads a
// view — found live as "Failed to fetch dynamically imported module" and a
// blank panel. Reload once to pick up the new build. The flag stops a loop if
// the chunk is missing for some other reason.
window.addEventListener("vite:preloadError", (event) => {
  const key = "zelyq:reloaded-for-new-build";
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: reloading once is still better than a dead view.
  }
  event.preventDefault();
  window.location.reload();
});
// Cleared only once the app has run for a while — not on `load`, which the
// reload itself fires: clearing there would let a chunk that is missing from
// the new build too reload the page forever. After this, a later deploy can
// reload the tab again.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem("zelyq:reloaded-for-new-build");
  } catch {
    // Nothing to clear.
  }
}, 30_000);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

// The language first, then the app: every screen, menu and constant is
// written in it from the first paint.
const root = createRoot(container);
void loadLanguage(initialLanguage())
  .catch(() => loadLanguage("en"))
  .then(() => import("./App"))
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
