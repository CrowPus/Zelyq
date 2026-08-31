import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { detectDevCommand } from "../src/local.js";

const root = path.join(os.tmpdir(), `zelyq-detect-dev-${Date.now()}`);
after(() => fs.rm(root, { recursive: true, force: true }));

async function withManifest(manifest: unknown): Promise<string> {
  const dir = path.join(root, `p${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

test("vite is unchanged — port, host, strictPort", async () => {
  const dir = await withManifest({ scripts: { dev: "vite" }, devDependencies: { vite: "^6" } });
  assert.equal(
    await detectDevCommand(dir, 5000, "127.0.0.1"),
    "npm run dev -- --port 5000 --host 127.0.0.1 --strictPort",
  );
});

test("next is unchanged — port, hostname", async () => {
  const dir = await withManifest({ scripts: { dev: "next dev" }, dependencies: { next: "15" } });
  assert.equal(
    await detectDevCommand(dir, 5000, "0.0.0.0"),
    "npm run dev -- --port 5000 --hostname 0.0.0.0",
  );
});

test("066: expo in dependencies → npm run dev -- --port <n>, no host/strictPort flags", async () => {
  const dir = await withManifest({
    scripts: { dev: "cross-env CI=1 expo start --web" },
    dependencies: { expo: "~52.0.0", "expo-router": "~4.0.0" },
  });
  assert.equal(await detectDevCommand(dir, 4321, "0.0.0.0"), "npm run dev -- --port 4321");
});

test("066: expo named only in the dev script still detects", async () => {
  const dir = await withManifest({ scripts: { dev: "expo start --web" } });
  assert.equal(await detectDevCommand(dir, 4321, "0.0.0.0"), "npm run dev -- --port 4321");
});

test("066: expo does not shadow vite when both somehow appear (vite wins, unchanged order)", async () => {
  const dir = await withManifest({
    scripts: { dev: "vite" },
    devDependencies: { vite: "^6", expo: "~52" },
  });
  assert.match(await detectDevCommand(dir, 5000, "127.0.0.1"), /--strictPort$/);
});

test("an unrecognised dev server: bare npm run dev, PORT/HOST left to the env", async () => {
  const dir = await withManifest({ scripts: { dev: "node server.js" } });
  assert.equal(await detectDevCommand(dir, 5000, "127.0.0.1"), "npm run dev");
});
