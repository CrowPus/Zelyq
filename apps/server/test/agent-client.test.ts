import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { AgentClient } from "../src/services/agent-client.js";

/**
 * Stands in for the real agent — just enough of its `/sessions` surface to
 * drive `ensureSession`'s own decision logic, not the model loop behind it.
 */
function fakeAgent() {
  const state = {
    id: "ses_fixed",
    provider: "google",
    model: "gemini-3.7-flash",
    busy: false,
    /** Mirrors the real agent: GET only succeeds once POST has created it. */
    created: true,
  };
  const calls: string[] = [];

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && req.url === `/sessions/${state.id}/state`) {
      calls.push("GET state");
      if (!state.created) {
        send(404, { error: { message: "not found" } });
        return;
      }
      send(200, {
        sessionId: state.id,
        projectId: "prj_1",
        provider: state.provider,
        model: state.model,
        effort: "high",
        busy: state.busy,
        turns: 1,
        tokensIn: 10,
        tokensOut: 10,
      });
      return;
    }

    if (req.method === "DELETE" && req.url === `/sessions/${state.id}`) {
      calls.push("DELETE");
      state.created = false;
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/sessions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        calls.push("POST create");
        const input = JSON.parse(body);
        state.provider = input.provider ?? state.provider;
        state.model = input.model ?? state.model;
        state.created = true;
        send(201, {
          sessionId: state.id,
          projectId: input.projectId,
          provider: state.provider,
          model: state.model,
          effort: "high",
          busy: false,
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      });
      return;
    }

    send(404, { error: { message: "not found" } });
  });

  return { server, state, calls };
}

let agent: ReturnType<typeof fakeAgent>;
let client: AgentClient;

before(async () => {
  agent = fakeAgent();
  await new Promise<void>((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
  const address = agent.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  client = new AgentClient(`http://127.0.0.1:${port}`);
});

after(async () => {
  await new Promise<void>((resolve) => agent.server.close(() => resolve()));
});

test("a matched provider and model reuses the cached session — no delete, no recreate", async () => {
  agent.state.provider = "google";
  agent.state.model = "gemini-3.7-flash";
  agent.state.busy = false;
  agent.state.created = true;
  agent.calls.length = 0;

  const result = await client.ensureSession({
    sessionId: "ses_fixed",
    projectId: "prj_1",
    provider: "google",
    model: "gemini-3.7-flash",
  });

  assert.deepEqual(agent.calls, ["GET state"], "a match must not delete or recreate");
  assert.equal(result.provider, "google");
});

test("an unmatched provider on a non-busy session deletes then recreates", async () => {
  agent.state.provider = "google";
  agent.state.model = "gemini-3.7-flash";
  agent.state.busy = false;
  agent.calls.length = 0;

  const result = await client.ensureSession({
    sessionId: "ses_fixed",
    projectId: "prj_1",
    provider: "openai",
    model: "gpt-5.1",
  });

  assert.deepEqual(agent.calls, ["GET state", "DELETE", "POST create"]);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.1");
});

test("a busy session with a mismatched provider is left alone for this call", async () => {
  agent.state.provider = "google";
  agent.state.model = "gemini-3.7-flash";
  agent.state.busy = true;
  agent.calls.length = 0;

  const result = await client.ensureSession({
    sessionId: "ses_fixed",
    projectId: "prj_1",
    provider: "openai",
    model: "gpt-5.1",
  });

  assert.deepEqual(agent.calls, ["GET state"], "a busy session must never be deleted mid-turn");
  assert.equal(result.provider, "google", "the in-flight turn keeps running on its own provider");
});

test("no session cached yet creates one normally", async () => {
  const freshAgent = fakeAgent();
  await new Promise<void>((resolve) => freshAgent.server.listen(0, "127.0.0.1", resolve));
  const address = freshAgent.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const freshClient = new AgentClient(`http://127.0.0.1:${port}`);
  freshAgent.state.id = "ses_never_seen";
  freshAgent.state.created = false;

  const result = await freshClient.ensureSession({
    sessionId: "ses_never_seen",
    projectId: "prj_1",
    provider: "anthropic",
    model: "claude-opus-5",
  });

  assert.deepEqual(freshAgent.calls, ["GET state", "POST create"]);
  assert.equal(result.provider, "anthropic");
  await new Promise<void>((resolve) => freshAgent.server.close(() => resolve()));
});
