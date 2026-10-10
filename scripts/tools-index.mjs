#!/usr/bin/env node
/**
 * Builds packages/core/src/tools.json: the approved tools list `setup` steps
 * install from (see docs/pipeline-steps-plan.md).
 *
 * It asks each official source what it publishes, and writes, for every tool,
 * version, operating system and CPU, the download address and the SHA-256
 * that source publishes for it. Nothing is downloaded here except those lists.
 *
 *   node scripts/tools-index.mjs
 *
 * Then review the diff and open a pull request: merging it is the approval.
 */
import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "packages", "core", "src", "tools.json");
const PLATFORMS = [
  "linux-x64",
  "linux-arm64",
  "macos-x64",
  "macos-arm64",
  "windows-x64",
  "windows-arm64",
];

async function json(url, headers = {}) {
  const response = await fetch(url, { headers: { "user-agent": "zelyq-tools-index", ...headers } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}
async function text(url) {
  const response = await fetch(url, { headers: { "user-agent": "zelyq-tools-index" } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}
const compare = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
};

// ------------------------------------------------------------------- Node
async function node() {
  const index = await json("https://nodejs.org/dist/index.json");
  const lts = index.filter((release) => release.lts);
  const majors = [...new Set(lts.map((release) => Number(release.version.slice(1).split(".")[0])))]
    .sort((a, b) => b - a)
    .slice(0, 3);
  const names = {
    "linux-x64": "linux-x64.tar.gz",
    "linux-arm64": "linux-arm64.tar.gz",
    "macos-x64": "darwin-x64.tar.gz",
    "macos-arm64": "darwin-arm64.tar.gz",
    "windows-x64": "win-x64.zip",
    "windows-arm64": "win-arm64.zip",
  };
  const versions = [];
  for (const major of majors) {
    const release = lts.find((candidate) => candidate.version.startsWith(`v${major}.`));
    const version = release.version.slice(1);
    const sums = await text(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`);
    const files = {};
    for (const platform of PLATFORMS) {
      const file = `node-v${version}-${names[platform]}`;
      const sha256 = sums
        .split("\n")
        .find((line) => line.endsWith(`  ${file}`))
        ?.split(" ")[0];
      if (!sha256) continue;
      const home = file.replace(/\.(tar\.gz|zip)$/, "");
      files[platform] = {
        url: `https://nodejs.org/dist/v${version}/${file}`,
        sha256,
        home,
        bins: [platform.startsWith("windows") ? "" : "bin"],
      };
    }
    versions.push({ version, lts: true, files });
  }
  return versions;
}

// ----------------------------------------------------------------- Python
async function python() {
  const release = await json(
    "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest",
    process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  );
  const sums = await text(
    release.assets.find((asset) => asset.name === "SHA256SUMS").browser_download_url,
  );
  const triples = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "macos-x64": "x86_64-apple-darwin",
    "macos-arm64": "aarch64-apple-darwin",
    "windows-x64": "x86_64-pc-windows-msvc",
    "windows-arm64": "aarch64-pc-windows-msvc",
  };
  const byVersion = new Map();
  for (const asset of release.assets) {
    const match = /^cpython-(\d+\.\d+\.\d+)\+\d+-(.+)-install_only\.tar\.gz$/.exec(asset.name);
    if (!match) continue;
    const [, version, triple] = match;
    const platform = Object.keys(triples).find((key) => triples[key] === triple);
    if (!platform) continue;
    const sha256 = sums
      .split("\n")
      .find((line) => line.endsWith(`  ${asset.name}`))
      ?.split(" ")[0];
    if (!sha256) continue;
    const files = byVersion.get(version) ?? {};
    files[platform] = {
      url: asset.browser_download_url,
      sha256,
      home: "python",
      bins: platform.startsWith("windows") ? ["", "Scripts"] : ["bin"],
    };
    byVersion.set(version, files);
  }
  const newest = new Map();
  for (const version of [...byVersion.keys()].sort(compare)) {
    const minor = version.split(".").slice(0, 2).join(".");
    if (!newest.has(minor)) newest.set(minor, version);
  }
  return [...newest.values()]
    .slice(0, 4)
    .map((version) => ({ version, files: byVersion.get(version) }));
}

// ------------------------------------------------------------------- Java
async function java() {
  const available = await json("https://api.adoptium.net/v3/info/available_releases");
  const features = available.available_lts_releases.slice(-3).reverse();
  const names = {
    "linux-x64": ["linux", "x64"],
    "linux-arm64": ["linux", "aarch64"],
    "macos-x64": ["mac", "x64"],
    "macos-arm64": ["mac", "aarch64"],
    "windows-x64": ["windows", "x64"],
    "windows-arm64": ["windows", "aarch64"],
  };
  const versions = [];
  for (const feature of features) {
    const files = {};
    let version = null;
    for (const platform of PLATFORMS) {
      const [os, arch] = names[platform];
      const assets = await json(
        `https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`,
      );
      const asset = assets[0];
      if (!asset) continue;
      const pkg = asset.binary.package;
      if (!/\.(tar\.gz|zip)$/.test(pkg.name)) continue;
      version ??= `${asset.version.major}.${asset.version.minor}.${asset.version.security}`;
      const root = asset.release_name;
      const home = os === "mac" ? `${root}/Contents/Home` : root;
      files[platform] = { url: pkg.link, sha256: pkg.checksum, home, bins: ["bin"] };
    }
    if (version) versions.push({ version, files });
  }
  return versions;
}

// --------------------------------------------------------------------- Go
async function go() {
  const releases = await json("https://go.dev/dl/?mode=json");
  const names = {
    "linux-x64": ["linux", "amd64"],
    "linux-arm64": ["linux", "arm64"],
    "macos-x64": ["darwin", "amd64"],
    "macos-arm64": ["darwin", "arm64"],
    "windows-x64": ["windows", "amd64"],
    "windows-arm64": ["windows", "arm64"],
  };
  return releases
    .filter((release) => release.stable)
    .map((release) => {
      const files = {};
      for (const platform of PLATFORMS) {
        const [os, arch] = names[platform];
        const file = release.files.find(
          (candidate) =>
            candidate.os === os && candidate.arch === arch && candidate.kind === "archive",
        );
        if (file) {
          files[platform] = {
            url: `https://go.dev/dl/${file.filename}`,
            sha256: file.sha256,
            home: "go",
            bins: ["bin"],
          };
        }
      }
      return { version: release.version.replace(/^go/, ""), files };
    });
}

const tools = { node: await node(), python: await python(), java: await java(), go: await go() };
for (const [name, versions] of Object.entries(tools)) {
  console.log(
    `${name}: ${versions.map((entry) => `${entry.version} (${Object.keys(entry.files).length})`).join(", ")}`,
  );
}
await fs.writeFile(
  OUT,
  `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), tools }, null, 2)}\n`,
);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
