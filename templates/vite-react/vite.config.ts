import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Zelyq assigns the port through PORT so several previews can run side by side.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/…` means `src/…`. TypeScript is told the same thing in tsconfig.json, and
  // both halves are needed: without this one the bundler resolves nothing, and
  // without that one `tsc` and the editor disagree with the bundler. Component
  // sets that get copied into a project rather than installed — shadcn/ui,
  // Motion Primitives — import their helpers from `@/lib/utils` and assume it.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    // Zelyq supplies HOST and PORT. HOST is loopback unless Zelyq itself runs
    // somewhere the viewer's browser has to reach over the network.
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
