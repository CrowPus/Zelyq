import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { PAGE_ROUTES } from "./src/lib/page-routes";

// The repo's .env, so the dev server honours the same settings as the other
// two processes. Real environment variables still win.
const repoEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
if (fs.existsSync(repoEnv)) {
  try {
    process.loadEnvFile(repoEnv);
  } catch {
    // Malformed .env — fall back to the ambient environment.
  }
}

/**
 * main.tsx loads the language before it imports the app, so the app's chunk
 * is only asked for once the entry has run: one round trip after another.
 * A modulepreload for that chunk (and the chunks it imports) in the page
 * fetches them alongside the entry. Preloading only downloads and parses: the
 * app still runs after the language is in.
 */
function preloadApp(): Plugin {
  return {
    name: "zelyq:preload-app",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const app = Object.values(bundle).find(
          (chunk) => chunk.type === "chunk" && chunk.facadeModuleId?.endsWith("/src/App.tsx"),
        );
        if (!app || app.type !== "chunk") return [];
        const files = new Set<string>([app.fileName]);
        for (const name of app.imports) files.add(name);
        // The text face every page is set in: found only once the CSS has
        // loaded otherwise, and the largest text on a page waits for it.
        const font = Object.keys(bundle).find((file) =>
          /\/inter-latin-wght-normal-[^/]+\.woff2$/.test(file),
        );
        return [
          ...(font
            ? [
                {
                  tag: "link",
                  attrs: {
                    rel: "preload",
                    as: "font",
                    type: "font/woff2",
                    crossorigin: true,
                    href: `/${font}`,
                  },
                  injectTo: "head" as const,
                },
              ]
            : []),
          ...[...files]
            .filter((file) => !(bundle[file]?.type === "chunk" && bundle[file].isEntry))
            .map((file) => ({
              tag: "link",
              attrs: { rel: "modulepreload", crossorigin: true, href: `/${file}` },
              injectTo: "head" as const,
            })),
        ];
      },
    },
  };
}

/**
 * A page's code is asked for only once the app has run and matched the
 * address: another round trip after the app's own. This puts a few lines in
 * index.html that match the address against src/lib/page-routes.ts and
 * preload that page's chunks straight away, alongside the app's.
 */
function preloadPages(): Plugin {
  return {
    name: "zelyq:preload-pages",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const chunks = Object.values(bundle).flatMap((item) =>
          item.type === "chunk" ? [item] : [],
        );
        const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const app = chunks.find((chunk) => chunk.facadeModuleId?.endsWith("/src/App.tsx"));
        // Already in the page: the entry, the app and what the app imports.
        const loaded = new Set(
          chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
        );
        if (app) for (const file of [app.fileName, ...app.imports]) loaded.add(file);
        const files: string[] = [];
        const routes = PAGE_ROUTES.map(([pattern, page, early = []]) => {
          const chunk =
            page && chunks.find((c) => c.facadeModuleId?.endsWith(`/src/pages/${page}.tsx`));
          const needed = new Set<string>();
          const visit = (file: string) => {
            if (loaded.has(file) || needed.has(file)) return;
            needed.add(file);
            for (const next of byName.get(file)?.imports ?? []) visit(next);
          };
          if (chunk) visit(chunk.fileName);
          return [
            pattern,
            [...needed].map((file) => {
              if (!files.includes(file)) files.push(file);
              return files.indexOf(file);
            }),
            early,
          ];
        });
        const script = `(()=>{var f=${JSON.stringify(files)},r=${JSON.stringify(routes)},p=location.pathname;for(var i=0;i<r.length;i++)if(new RegExp(r[i][0]).test(p)){r[i][1].forEach(function(n){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href="/"+f[n];document.head.appendChild(l)});var e=window.__zelyqEarly;if(e)r[i][2].forEach(function(a){e[a]=fetch("/api"+a,{credentials:"same-origin"})});break}})()`;
        // In place of the marker, above the stylesheet: an inline script after
        // a stylesheet waits for it to load, and this one should not wait.
        const marker = /<!-- zelyq:preload-pages[\s\S]*?-->/;
        if (!marker.test(html)) throw new Error("index.html lost its zelyq:preload-pages marker");
        return html.replace(marker, () => `<script>${script}</script>`);
      },
    },
  };
}

const SERVER = process.env.ZELYQ_SERVER_URL ?? "http://127.0.0.1:8787";

// In development the SPA runs on its own port and proxies to the API, so there
// is no CORS story to get wrong. In production the server serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadApp(), preloadPages()],
  server: {
    // Bind IPv4 explicitly. Vite's default resolves to ::1 only on some hosts,
    // which breaks IPv4 clients and editor/SSH port forwarding. Set
    // ZELYQ_WEB_HOST=0.0.0.0 to reach the dev server from another machine.
    host: process.env.ZELYQ_WEB_HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Every icon shared between pages became its own 1 KB file, and a
          // page like the app builder fetched twenty-five of them one after
          // another on a phone's latency. One file holds them all instead.
          groups: [{ name: "icons", test: /[\\/]node_modules[\\/].*lucide-react[\\/]/ }],
        },
      },
    },
  },
});
