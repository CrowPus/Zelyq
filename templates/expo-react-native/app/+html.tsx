import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * The web-only HTML shell Expo Router wraps every route in. Native builds
 * never see this file. It only takes effect with `web.output: "static"` in
 * app.json (set) — an SPA build uses a fixed shell instead.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
      </head>
      <body>
        {children}
        {/* Zelyq's element inspector — the script body is public/zelyq-inspector.js.
            Inert until Zelyq's own page activates it with a postMessage; does
            nothing to this app otherwise. Safe to delete both if you'd rather
            not have it. Kept in step with templates/_shared/inspector.js by a
            test in apps/server/test/inspector-script.test.ts. */}
        <script src="/zelyq-inspector.js" defer />
      </body>
    </html>
  );
}
