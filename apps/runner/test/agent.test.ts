import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUrl, checkUrl, commandLine, frame, socketUrl, unframe } from "../src/agent.js";

test("addresses: https only (or this machine), no double slashes", () => {
  assert.equal(
    socketUrl(checkUrl("https://app.zelyq.dev/")),
    "wss://app.zelyq.dev/ws/runner-agent",
  );
  assert.equal(
    socketUrl(checkUrl("https://example.com/zelyq/")),
    "wss://example.com/zelyq/ws/runner-agent",
  );
  assert.equal(socketUrl(checkUrl("http://127.0.0.1:8080")), "ws://127.0.0.1:8080/ws/runner-agent");
  assert.equal(baseUrl(checkUrl("https://app.zelyq.dev")), "https://app.zelyq.dev");
  assert.throws(() => checkUrl("http://app.zelyq.dev"), /https/);
  assert.throws(() => checkUrl("not a url"), /not an address/);
});

test("frames carry their type, id and bytes", () => {
  const out = unframe(frame(2, 4_000_000_000, Buffer.from("hi")));
  assert.deepEqual([out?.type, out?.id, out?.payload.toString()], [2, 4_000_000_000, "hi"]);
  assert.equal(unframe(Buffer.from([1, 2])), null);
});

test("a command starts the way the machine's own SSH server would start it", () => {
  // Linux and macOS: the user's shell, in a process group of its own so a stop reaches it all.
  assert.deepEqual(commandLine("echo hi", "/bin/zsh", "darwin"), {
    file: "/bin/zsh",
    args: ["-c", "echo hi"],
    windowsVerbatimArguments: false,
    detached: true,
  });
  // Windows: cmd.exe, the command passed as written, quotes and all.
  const command =
    'powershell -NoProfile -Command "& ([scriptblock]::Create([Console]::In.ReadToEnd()))"';
  const windows = commandLine(command, "/bin/sh", "win32");
  assert.match(windows.file, /cmd\.exe$/i);
  assert.deepEqual(windows.args, ["/d", "/s", "/c", `"${command}"`]);
  assert.equal(windows.windowsVerbatimArguments, true);
  assert.equal(windows.detached, false);
});
