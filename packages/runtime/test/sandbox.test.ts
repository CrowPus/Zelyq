import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import {
  isPlainRuntime,
  isSandboxRuntime,
  SANDBOX_BLOCKED_RANGES,
  sandboxBridgeName,
  sandboxFirewallScript,
  sandboxFromEnv,
  sandboxNetworkArgs,
  sandboxRunArgs,
} from "../src/sandbox.js";

const MANAGED = {
  ZELYQ_ACCOUNTS_URL: "https://accounts.example.com",
  ZELYQ_CONTAINER_RUNTIME: "runsc",
};

test("a self-hosted server is unchanged unless its owner turns the sandbox on", () => {
  assert.deepEqual(sandboxFromEnv({}, "local"), { strict: false, dns: [] });
  assert.equal(sandboxFromEnv({ ZELYQ_STRICT_SANDBOX: "false" }, "local").strict, false);
  const opted = sandboxFromEnv({ ZELYQ_STRICT_SANDBOX: "true" }, "container");
  assert.equal(opted.strict, true);
  // Opting in on your own server does not require gVisor.
  assert.equal(opted.runtime, undefined);
  assert.deepEqual(opted.dns, ["1.1.1.1", "8.8.8.8"]);
});

test("a managed server is always strict, and refuses to start when the sandbox would not hold", () => {
  const managed = sandboxFromEnv(MANAGED, "container");
  assert.equal(managed.strict, true);
  assert.equal(managed.runtime, "runsc");

  assert.throws(
    () => sandboxFromEnv({ ...MANAGED, ZELYQ_STRICT_SANDBOX: "false" }, "container"),
    /cannot be false on a managed server/,
  );
  // The agent's commands outside a container.
  assert.throws(() => sandboxFromEnv(MANAGED, "local"), /ZELYQ_RUNTIME=container/);
  assert.throws(() => sandboxFromEnv(MANAGED, "remote"), /ZELYQ_RUNTIME=container/);
  // No gVisor.
  assert.throws(
    () => sandboxFromEnv({ ZELYQ_ACCOUNTS_URL: MANAGED.ZELYQ_ACCOUNTS_URL }, "container"),
    /gVisor/,
  );
  assert.throws(
    () => sandboxFromEnv({ ...MANAGED, ZELYQ_CONTAINER_RUNTIME: "runc" }, "container"),
    /gVisor/,
  );
  // Pipelines on the server itself.
  assert.throws(
    () => sandboxFromEnv({ ...MANAGED, ZELYQ_PIPELINE_LOCAL_RUNNER: "host" }, "container"),
    /ZELYQ_PIPELINE_LOCAL_RUNNER=host/,
  );
  assert.throws(
    () => sandboxFromEnv({ ...MANAGED, ZELYQ_SANDBOX_DNS: "1.1.1.1; rm -rf /" }, "container"),
    /ZELYQ_SANDBOX_DNS/,
  );
  assert.deepEqual(
    sandboxFromEnv({ ...MANAGED, ZELYQ_SANDBOX_DNS: " 9.9.9.9 , 149.112.112.112" }, "container")
      .dns,
    ["9.9.9.9", "149.112.112.112"],
  );
});

test("which runtimes count as plain Docker", () => {
  for (const plain of [undefined, "", "runc", "io.containerd.runc.v2"]) {
    assert.equal(isPlainRuntime(plain), true, String(plain));
  }
  for (const sandboxed of ["runsc", "runsc-kvm", "kata"]) {
    assert.equal(isPlainRuntime(sandboxed), false, sandboxed);
  }
});

test("every sandbox network gets a zsbx bridge that Linux accepts", () => {
  assert.equal(sandboxBridgeName("zelyq-sandbox"), "zsbx0");
  const name = sandboxBridgeName("zelyq-run-abcdefghijklmnopqrstuvwx");
  assert.match(name, /^zsbx[0-9a-f]{11}$/);
  assert.ok(name.length <= 15);
  assert.notEqual(name, sandboxBridgeName("zelyq-run-another"));
  assert.deepEqual(sandboxNetworkArgs("zelyq-run-x", { strict: false, dns: [] }), []);
  assert.deepEqual(sandboxNetworkArgs("zelyq-run-x", { strict: true, dns: [] }), [
    "--opt",
    `com.docker.network.bridge.name=${sandboxBridgeName("zelyq-run-x")}`,
  ]);
});

test("a gVisor container gets its runtime and real name servers", async () => {
  assert.deepEqual(await sandboxRunArgs({ strict: false, dns: [] }), []);
  // Strict on plain Docker (a self-hoster's opt-in): Docker's own name server still works.
  assert.deepEqual(await sandboxRunArgs({ strict: true, dns: ["1.1.1.1"] }), []);
  const args = await sandboxRunArgs({
    strict: true,
    runtime: "runsc",
    dns: ["1.1.1.1", "8.8.8.8"],
  });
  assert.deepEqual(args.slice(0, 2), ["--runtime", "runsc"]);
  assert.equal(args[2], "--volume");
  const [file, target, mode] = (args[3] as string).split(":");
  assert.equal(target, "/etc/resolv.conf");
  assert.equal(mode, "ro");
  assert.equal(
    await fs.readFile(file as string, "utf8"),
    "nameserver 1.1.1.1\nnameserver 8.8.8.8\n",
  );
});

test("the firewall lets replies through, and blocks this server and every private range", () => {
  const script = sandboxFirewallScript();
  const lines = script.split("\n");
  const appended = (chain: string) =>
    lines.filter(
      (line) =>
        line.startsWith(`iptables -w -A ${chain} `) || line.startsWith(`ip6tables -w -A ${chain} `),
    );
  const forward = appended("ZELYQ-SBX-FWD-NEW");
  // Replies first; app containers never reach another sandbox container;
  // a run reaches its own services; then the blocks.
  assert.match(forward[0] as string, /ESTABLISHED,RELATED -j RETURN$/);
  assert.match(forward[1] as string, /-i zsbx0 -o zsbx\+ -j REJECT$/);
  assert.match(forward[2] as string, /-o zsbx\+ -j RETURN$/);
  for (const range of SANDBOX_BLOCKED_RANGES) {
    assert.ok(forward.includes(`iptables -w -A ZELYQ-SBX-FWD-NEW -d ${range} -j REJECT`), range);
  }
  for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]) {
    assert.ok(SANDBOX_BLOCKED_RANGES.includes(range), range);
  }
  assert.deepEqual(appended("ZELYQ-SBX-IN-NEW"), [
    "iptables -w -A ZELYQ-SBX-IN-NEW -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN",
    "iptables -w -A ZELYQ-SBX-IN-NEW -j REJECT",
  ]);
  // IPv6: nothing forwarded, nothing new to this server.
  assert.deepEqual(appended("ZELYQ-SBX6-FWD-NEW"), [
    "ip6tables -w -A ZELYQ-SBX6-FWD-NEW -j REJECT",
  ]);
  assert.deepEqual(appended("ZELYQ-SBX6-IN-NEW"), [
    "ip6tables -w -A ZELYQ-SBX6-IN-NEW -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN",
    "ip6tables -w -A ZELYQ-SBX6-IN-NEW -j REJECT",
  ]);
  // The new chains are hooked in before the old ones are removed: never a moment without rules.
  const hook = lines.indexOf("iptables -w -I DOCKER-USER 1 -i zsbx+ -j ZELYQ-SBX-FWD-NEW");
  const unhook = lines.indexOf(
    "while iptables -w -D DOCKER-USER -i zsbx+ -j ZELYQ-SBX-FWD 2>/dev/null; do :; done",
  );
  assert.ok(hook > 0 && unhook > hook, script);
  // It starts by proving Docker's firewall is the one it sees, and ends by proving every hook is there.
  assert.equal(lines[1], "iptables -w -C FORWARD -j DOCKER-USER");
  const tail = lines.slice(-6);
  assert.deepEqual(tail, [
    "iptables -w -C FORWARD -j DOCKER-USER",
    "iptables -w -C DOCKER-USER -i zsbx+ -j ZELYQ-SBX-FWD",
    "iptables -w -C INPUT -i zsbx+ -j ZELYQ-SBX-IN",
    "ip6tables -w -C FORWARD -i zsbx+ -j ZELYQ-SBX6-FWD",
    "ip6tables -w -C INPUT -i zsbx+ -j ZELYQ-SBX6-IN",
    "echo ZELYQ_SANDBOX_FIREWALL_OK",
  ]);
});

test("only a runtime with a kernel of its own counts as a sandbox", () => {
  for (const runtime of ["runsc", "runsc-kvm", "kata", "kata-qemu"]) {
    assert.equal(isSandboxRuntime(runtime), true, runtime);
  }
  for (const runtime of [undefined, "runc", "crun", "nvidia", "youki", "runscx"]) {
    assert.equal(isSandboxRuntime(runtime), false, String(runtime));
  }
  assert.throws(
    () => sandboxFromEnv({ ...MANAGED, ZELYQ_CONTAINER_RUNTIME: "crun" }, "container"),
    /gVisor/,
  );
});
