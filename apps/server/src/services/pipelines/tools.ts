import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type PipelineTool,
  resolveToolVersion,
  TOOL_HOME_VARIABLES,
  type ToolFile,
  type ToolPlatform,
  toolReleases,
} from "@zelyq/core";
import { shellCommand } from "./scripts.js";
import type { LocatedTool, Machine, StepContext } from "./steps.js";

/**
 * Puts approved tools on machines (see docs/pipeline-steps-plan.md, section
 * 3). A machine keeps what it got in `<its zelyq folder>/tools/<tool>/<version>/
 * <platform>/`, finished copies marked with `.complete`, so a tool is fetched
 * once per machine. Only what the approved list names is installed, and only
 * when the file matches the SHA-256 in that list.
 */

const TITLES: Record<PipelineTool, string> = {
  node: "Node",
  python: "Python",
  java: "Java",
  go: "Go",
};

/** Files a project uses to say which version it wants. */
const VERSION_FILES: Record<PipelineTool, string[]> = {
  node: [".nvmrc", ".node-version"],
  python: [".python-version"],
  java: [".java-version"],
  go: ["go.mod"],
};

function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function psq(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class ToolService {
  /** @param downloadsDir where this server keeps files it fetched (for the local runner) */
  constructor(private readonly downloadsDir: string) {}

  /** Makes sure the tool is on the machine, and says where. */
  async ensure(
    context: StepContext,
    wanted: { tool: PipelineTool; version: string | null },
  ): Promise<LocatedTool | { error: string }> {
    const { machine } = context;
    const title = TITLES[wanted.tool];
    const platform = await this.platform(machine);
    if ("error" in platform) return platform;
    const version = wanted.version ?? (await this.versionFromProject(context, wanted.tool));
    const release = resolveToolVersion(wanted.tool, version);
    if (!release) {
      return {
        error: `${title} ${version} is not on Zelyq's approved tools list. Approved: ${this.versionsOf(wanted.tool)}.`,
      };
    }
    const file = release.files[platform.platform];
    if (!file) {
      return {
        error: `${title} ${release.version} has no approved build for ${platform.platform}.`,
      };
    }
    const dir = this.dir(machine, wanted.tool, release.version, platform.platform);
    const located = this.located(machine, wanted.tool, release.version, dir, file);
    if (await this.complete(machine, dir)) {
      context.system(`${title} ${release.version} is already on this machine.`);
      return located;
    }

    const windows = machine.os === "windows";
    const extension = file.url.endsWith(".zip") ? ".zip" : ".tar.gz";
    if (machine.kind !== "ssh" && !windows) {
      // The local runner: this server fetches the file once and hands it over.
      context.system(`Getting ${title} ${release.version} (${platform.platform}).`);
      const local = await this.download(file, extension);
      const copied = await context.exec(
        `rm -rf ${sq(`${dir}.part`)} && mkdir -p ${sq(`${dir}.part`)} && cat > ${sq(`${dir}.part/download${extension}`)}`,
        createReadStream(local),
        { quiet: true },
      );
      if (copied.ended) return { error: "Stopped." };
      if (copied.code !== 0) return { error: `Could not copy ${title} onto the machine.` };
    } else {
      context.system(
        `Downloading ${title} ${release.version} (${platform.platform}) from ${new URL(file.url).host}.`,
      );
    }
    const installed = await context.exec(
      shellCommand(windows ? "powershell" : "sh"),
      windows
        ? windowsInstallScript(dir, file, extension)
        : posixInstallScript(dir, file, extension, machine.kind === "ssh", wanted.tool),
    );
    if (installed.ended) return { error: "Stopped." };
    if (installed.code !== 0) {
      return { error: `Could not install ${title} ${release.version} on this machine.` };
    }
    return located;
  }

  /** Where a tool already on the machine is, after a restart; null if gone. */
  async locate(
    wanted: { tool: PipelineTool; version: string | null },
    machine: Machine,
  ): Promise<LocatedTool | null> {
    const platform = await this.platform(machine);
    if ("error" in platform) return null;
    const release = resolveToolVersion(wanted.tool, wanted.version);
    const file = release?.files[platform.platform];
    if (!release || !file) return null;
    const dir = this.dir(machine, wanted.tool, release.version, platform.platform);
    if (!(await this.complete(machine, dir))) return null;
    return this.located(machine, wanted.tool, release.version, dir, file);
  }

  private versionsOf(tool: PipelineTool): string {
    return toolReleases(tool)
      .map((release) => release.version)
      .join(", ");
  }

  /** Operating system and CPU, as the approved list names them. */
  private async platform(
    machine: Machine,
  ): Promise<{ platform: ToolPlatform } | { error: string }> {
    if (machine.os === "windows") {
      const arch = await captureOf(machine, "echo %PROCESSOR_ARCHITECTURE%");
      return { platform: /ARM64/i.test(arch) ? "windows-arm64" : "windows-x64" };
    }
    const arch = (await captureOf(machine, "uname -m")).trim();
    const cpu = /^(aarch64|arm64)$/.test(arch)
      ? "arm64"
      : /^(x86_64|amd64)$/.test(arch)
        ? "x64"
        : null;
    if (!cpu)
      return { error: `setup does not support this machine's processor (${arch || "unknown"}).` };
    if (machine.os === "linux") {
      const libc = await captureOf(machine, "ldd --version 2>&1 | head -1");
      if (/musl/i.test(libc)) {
        return {
          error:
            "setup needs a Linux with glibc (Debian, Ubuntu, Fedora…); this machine uses musl (Alpine). Use an image with the tool installed instead.",
        };
      }
    }
    return { platform: `${machine.os === "macos" ? "macos" : "linux"}-${cpu}` as ToolPlatform };
  }

  /** The version a project's own files ask for (.nvmrc, .python-version, go.mod…). */
  private async versionFromProject(
    context: StepContext,
    tool: PipelineTool,
  ): Promise<string | null> {
    const { machine } = context;
    for (const name of VERSION_FILES[tool]) {
      const file = `${context.dir}${machine.os === "windows" ? "\\" : "/"}${name}`;
      const text = await captureOf(
        machine,
        machine.os === "windows" ? `type "${file}" 2>nul` : `cat ${sq(file)} 2>/dev/null`,
      );
      if (!text.trim()) continue;
      if (tool === "go") {
        const match = /^go\s+(\d+\.\d+)/m.exec(text);
        if (match?.[1]) return match[1];
        continue;
      }
      const value = text.trim().split(/\s+/)[0]?.replace(/^v/, "") ?? "";
      if (/^lts\//i.test(value)) return "lts";
      if (/^\d+(\.\d+){0,2}$/.test(value)) return value;
    }
    return null;
  }

  private dir(
    machine: Machine,
    tool: PipelineTool,
    version: string,
    platform: ToolPlatform,
  ): string {
    const s = machine.os === "windows" ? "\\" : "/";
    return [machine.zelyqDir, "tools", tool, version, platform].join(s);
  }

  private located(
    machine: Machine,
    tool: PipelineTool,
    version: string,
    dir: string,
    file: ToolFile,
  ): LocatedTool {
    const s = machine.os === "windows" ? "\\" : "/";
    const home = [dir, ...file.home.split("/")].join(s);
    return {
      version,
      home,
      bins: file.bins.map((bin) => (bin ? [home, ...bin.split("/")].join(s) : home)),
      homeVariable: TOOL_HOME_VARIABLES[tool] ?? null,
    };
  }

  private async complete(machine: Machine, dir: string): Promise<boolean> {
    const command =
      machine.os === "windows"
        ? `if exist "${dir}\\.complete" (exit 0) else (exit 1)`
        : `test -f ${sq(`${dir}/.complete`)}`;
    return (await machine.exec(command, {}).catch(() => ({ code: 1 }))).code === 0;
  }

  /** This server's own copy of a file, fetched once and checked. */
  private async download(file: ToolFile, extension: string): Promise<string> {
    const target = path.join(this.downloadsDir, `${file.sha256}${extension}`);
    if (await fs.stat(target).catch(() => null)) return target;
    await fs.mkdir(this.downloadsDir, { recursive: true });
    const part = `${target}.part`;
    const response = await fetch(file.url, { redirect: "follow" });
    if (!response.ok || !response.body)
      throw new Error(`Downloading ${file.url} failed: ${response.status}.`);
    const hash = createHash("sha256");
    const body = Readable.fromWeb(response.body as never);
    body.on("data", (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(part));
    if (hash.digest("hex") !== file.sha256) {
      await fs.rm(part, { force: true });
      throw new Error("The download does not match the approved checksum; it was thrown away.");
    }
    await fs.rename(part, target);
    return target;
  }
}

/**
 * The script that puts a tool in `dir` on a Linux or macOS machine: download
 * (unless the file was copied there already), check the SHA-256 against the
 * approved list, unpack, and mark it finished. Exported for the machine tests.
 */
export function posixInstallScript(
  dir: string,
  file: ToolFile,
  extension: string,
  fetch: boolean,
  tool: PipelineTool,
): string {
  const archive = `${dir}.part/download${extension}`;
  return [
    "set -e",
    ...(fetch
      ? [
          `rm -rf ${sq(`${dir}.part`)}`,
          `mkdir -p ${sq(`${dir}.part`)}`,
          "if command -v curl >/dev/null 2>&1; then",
          `  curl -fsSL --retry 3 -o ${sq(archive)} ${sq(file.url)}`,
          "elif command -v wget >/dev/null 2>&1; then",
          `  wget -q -O ${sq(archive)} ${sq(file.url)}`,
          "else",
          '  echo "This machine needs curl or wget to download tools." >&2; exit 1',
          "fi",
        ]
      : []),
    `sum=$( (sha256sum ${sq(archive)} 2>/dev/null || shasum -a 256 ${sq(archive)}) | cut -d' ' -f1)`,
    `if [ "$sum" != ${sq(file.sha256)} ]; then`,
    `  rm -rf ${sq(`${dir}.part`)}`,
    '  echo "The download does not match the approved checksum; it was thrown away." >&2; exit 1',
    "fi",
    `tar -x${extension === ".zip" ? "" : "z"}f ${sq(archive)} -C ${sq(`${dir}.part`)}`,
    `rm -f ${sq(archive)}`,
    // Standalone Python names it python3; scripts often say python.
    ...(tool === "python"
      ? [
          `[ -e ${sq(`${dir}.part/python/bin/python`)} ] || ln -s python3 ${sq(`${dir}.part/python/bin/python`)}`,
        ]
      : []),
    `rm -rf ${sq(dir)}`,
    `mv ${sq(`${dir}.part`)} ${sq(dir)}`,
    `touch ${sq(`${dir}/.complete`)}`,
    "",
  ].join("\n");
}

/** The same on Windows, in Windows PowerShell 5.1 or later. */
export function windowsInstallScript(dir: string, file: ToolFile, extension: string): string {
  const part = `${dir}.part`;
  const archive = `${part}\\download${extension}`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `Remove-Item -LiteralPath ${psq(part)} -Recurse -Force -ErrorAction SilentlyContinue`,
    `New-Item -ItemType Directory -Force -Path ${psq(part)} | Out-Null`,
    // Windows PowerShell 5.1 does not offer TLS 1.2 unless asked.
    "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
    `Invoke-WebRequest -UseBasicParsing -Uri ${psq(file.url)} -OutFile ${psq(archive)}`,
    `if ((Get-FileHash -Algorithm SHA256 -LiteralPath ${psq(archive)}).Hash.ToLower() -ne ${psq(file.sha256)}) {`,
    `  Remove-Item -LiteralPath ${psq(part)} -Recurse -Force`,
    "  throw 'The download does not match the approved checksum; it was thrown away.'",
    "}",
    `tar -xf ${psq(archive)} -C ${psq(part)}`,
    "if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the download.' }",
    `Remove-Item -LiteralPath ${psq(archive)} -Force`,
    `if (Test-Path -LiteralPath ${psq(dir)}) { Remove-Item -LiteralPath ${psq(dir)} -Recurse -Force }`,
    `Move-Item -LiteralPath ${psq(part)} -Destination ${psq(dir)}`,
    `New-Item -ItemType File -Force -Path ${psq(`${dir}\\.complete`)} | Out-Null`,
    "exit 0",
    "",
  ].join("\r\n");
}

/** Runs a short command on the machine and returns what it printed. */
async function captureOf(machine: Machine, command: string): Promise<string> {
  let out = "";
  await machine
    .exec(command, {
      onStdout: (chunk) => {
        out += chunk.toString("utf8");
      },
    })
    .catch(() => undefined);
  return out;
}
