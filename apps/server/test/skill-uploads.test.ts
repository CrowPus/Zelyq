import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { SkillUploadService } from "../src/services/skill-uploads.js";

/**
 * Uploading a skill through Settings — see `043` in the council notes.
 * Against a real filesystem and a real server, the same standard
 * `attachments.test.ts` already holds — a skill upload is a smaller,
 * text-scoped version of the same "someone sent us bytes" problem.
 */

const tmp = path.join(os.tmpdir(), `zelyq-skill-uploads-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const VALID_SKILL = [
  {
    path: "SKILL.md",
    data: b64(
      "---\nname: word-golf\ndescription: Say hi in as few words as possible.\n---\n\nJust say hi.\n",
    ),
  },
];

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

// --- Service-level tests -------------------------------------------------

test("SkillUploadService: a valid single-file skill is written and parsed correctly", async () => {
  const dir = path.join(tmp, "service-basic");
  const service = new SkillUploadService(dir);

  const result = await service.store(VALID_SKILL);
  assert.equal(result.name, "word-golf");
  assert.equal(result.description, "Say hi in as few words as possible.");
  assert.equal(result.fileCount, 1);

  const written = await fs.readFile(path.join(dir, "word-golf", "SKILL.md"), "utf8");
  assert.match(written, /Just say hi\./);
});

test("SkillUploadService: a multi-file skill keeps its subdirectory structure", async () => {
  const dir = path.join(tmp, "service-multi");
  const service = new SkillUploadService(dir);

  await service.store([
    {
      path: "SKILL.md",
      data: b64("---\nname: deep-skill\ndescription: has depth\n---\n\ntop level\n"),
    },
    { path: "references/detail.md", data: b64("the deeper reference content") },
  ]);

  const nested = await fs.readFile(path.join(dir, "deep-skill", "references", "detail.md"), "utf8");
  assert.equal(nested, "the deeper reference content");
});

test("SkillUploadService: re-uploading the same skill name replaces it cleanly, stale files removed", async () => {
  const dir = path.join(tmp, "service-replace");
  const service = new SkillUploadService(dir);

  await service.store([
    { path: "SKILL.md", data: b64("---\nname: replaceable\ndescription: v1\n---\n\nfirst\n") },
    { path: "references/old.md", data: b64("stale content") },
  ]);
  await service.store([
    { path: "SKILL.md", data: b64("---\nname: replaceable\ndescription: v2\n---\n\nsecond\n") },
  ]);

  const skillMd = await fs.readFile(path.join(dir, "replaceable", "SKILL.md"), "utf8");
  assert.match(skillMd, /v2/);
  await assert.rejects(
    fs.readFile(path.join(dir, "replaceable", "references", "old.md")),
    "a stale file from the first upload must not survive a replacement",
  );
});

test("SkillUploadService: no files at all is rejected", async () => {
  const service = new SkillUploadService(path.join(tmp, "service-empty"));
  await assert.rejects(() => service.store([]), /No files/);
});

test("SkillUploadService: a missing SKILL.md is rejected", async () => {
  const service = new SkillUploadService(path.join(tmp, "service-no-skill-md"));
  await assert.rejects(
    () => service.store([{ path: "references/only.md", data: b64("x") }]),
    /needs a SKILL\.md/,
  );
});

test("SkillUploadService: invalid SKILL.md content is rejected with the real reason", async () => {
  const service = new SkillUploadService(path.join(tmp, "service-invalid"));
  await assert.rejects(
    () => service.store([{ path: "SKILL.md", data: b64("no frontmatter here\n") }]),
    /frontmatter/,
  );
});

test("SkillUploadService: a path trying to escape the skill's own root is refused", async () => {
  const service = new SkillUploadService(path.join(tmp, "service-traversal"));
  await assert.rejects(
    () => service.store([...VALID_SKILL, { path: "../../etc/passwd", data: b64("nope") }]),
    /not a valid path/,
  );
});

test("SkillUploadService: an oversized upload is rejected before anything is written", async () => {
  const dir = path.join(tmp, "service-oversized");
  const service = new SkillUploadService(dir);
  const big = Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString("base64");

  await assert.rejects(
    () => service.store([...VALID_SKILL, { path: "references/huge.md", data: big }]),
    /2MB/,
  );
  await assert.rejects(fs.readdir(path.join(dir, "word-golf")));
});

test("SkillUploadService: too many files is rejected", async () => {
  const service = new SkillUploadService(path.join(tmp, "service-too-many"));
  const files = Array.from({ length: 51 }, (_, i) => ({
    path: i === 0 ? "SKILL.md" : `references/f${i}.md`,
    data: i === 0 ? VALID_SKILL[0]!.data : b64("x"),
  }));
  await assert.rejects(() => service.store(files), /at most/);
});

// --- Route-level tests ----------------------------------------------------

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "skill-uploads.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "route-attachments"),
  uploadedSkillsDir: path.join(tmp, "route-skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4990, 4995],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, `register ${email}: ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie, "no session cookie was set");
  return `zelyq_session=${cookie.value}`;
}

const as = (cookie: string) => ({ cookie });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  // First account promoted to admin; every account after it is an ordinary
  // member — the same setup settings.test.ts already establishes.
  adminCookie = await register("skill-admin@example.com", "Admin");
  memberCookie = await register("skill-member@example.com", "Member");
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

let adminCookie: string;
let memberCookie: string;

test("route: an instance admin can upload a skill", async () => {
  const upload = await server.app.inject({
    method: "POST",
    url: "/api/skills",
    headers: as(adminCookie),
    payload: { files: VALID_SKILL },
  });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().skill.name, "word-golf");
});

test("route: an ordinary member cannot upload a skill", async () => {
  const upload = await server.app.inject({
    method: "POST",
    url: "/api/skills",
    headers: as(memberCookie),
    payload: { files: VALID_SKILL },
  });
  assert.equal(upload.statusCode, 403);
});

test("route: an unauthenticated request is refused", async () => {
  const upload = await server.app.inject({
    method: "POST",
    url: "/api/skills",
    payload: { files: VALID_SKILL },
  });
  assert.equal(upload.statusCode, 401);
});

test("route: an invalid SKILL.md comes back as a clear 400, not a 500", async () => {
  const upload = await server.app.inject({
    method: "POST",
    url: "/api/skills",
    headers: as(adminCookie),
    payload: { files: [{ path: "SKILL.md", data: b64("not a real skill file") }] },
  });
  assert.equal(upload.statusCode, 400);
  assert.match(upload.json().error.message, /frontmatter/);
});
