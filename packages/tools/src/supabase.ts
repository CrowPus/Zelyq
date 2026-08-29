import { z } from "zod";
import { defineTool, type ToolResult, truncate } from "./types.js";

/**
 * The build agent applies its own Supabase migrations
 * and checks the result, without ever holding the Management credential. Both
 * tools call the Zelyq server through the session's bridge; the server holds
 * the credential and makes the Supabase call. They only exist for a project
 * that has a Supabase resource linked (Settings → Supabase).
 */

async function bridgeCall(
  context: { supabaseBridge?: { url: string; token: string }; signal: AbortSignal },
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const bridge = context.supabaseBridge;
  if (!bridge) {
    throw new Error(
      "No Supabase backend is linked to this project. An instance admin links one in Settings → Supabase.",
    );
  }
  const res = await fetch(`${bridge.url}/api/internal/supabase/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zelyq-supabase-bridge": bridge.token,
    },
    body: JSON.stringify(body),
    signal: context.signal,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export const supabaseApplyMigrationTool = defineTool({
  name: "supabase_apply_migration",
  description:
    "Apply a SQL migration file to this project's linked Supabase (development) database, through " +
    "the Zelyq server. Use it after writing a file under supabase/migrations/. `name` is the file's " +
    "base name (e.g. 0001_init). The server refuses destructive statements and a re-apply of the " +
    "same name with changed content. Only available when a Supabase backend is linked.",
  schema: z.object({
    name: z.string().min(1).describe("Migration name, e.g. the file's base name 0001_init"),
    path: z
      .string()
      .min(1)
      .describe("Path to the .sql file in the project, e.g. supabase/migrations/0001_init.sql"),
  }),
  async run(context, input): Promise<ToolResult> {
    let sql: string;
    try {
      sql = (await context.runtime.readFile(context.projectId, input.path)).content;
    } catch {
      return { output: `Could not read ${input.path}.`, isError: true };
    }
    try {
      const { ok, status, json } = await bridgeCall(context, "apply-migration", {
        name: input.name,
        sql,
      });
      if (!ok) {
        const message =
          (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${status}`;
        return { output: `Migration not applied: ${truncate(message, 2000)}`, isError: true };
      }
      const { alreadyApplied } = json as { alreadyApplied?: boolean };
      return {
        output: alreadyApplied
          ? `Migration "${input.name}" is already applied (unchanged).`
          : `Migration "${input.name}" applied to the linked Supabase development database.`,
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },
});

export const supabaseDeployFunctionTool = defineTool({
  name: "supabase_deploy_function",
  description:
    "Deploy one Edge Function to this project's linked Supabase (development) project, through the " +
    "Zelyq server — no terminal. Use it after writing a function's index file under " +
    "supabase/functions/<slug>/. `slug` is the folder name; `path` is the file to deploy. Creates " +
    "the function if new, updates it if it exists. `verifyJwt` defaults to true (the function " +
    "reads auth.uid()). If the automatic deploy fails, the result tells you the exact " +
    "`supabase functions deploy <slug>` command to give the user. Only available when a Supabase " +
    "backend is linked.",
  schema: z.object({
    slug: z.string().min(1).describe("The function folder name, e.g. save-credential"),
    path: z
      .string()
      .min(1)
      .describe(
        "Path to the function's entry file, e.g. supabase/functions/save-credential/index.ts",
      ),
    verifyJwt: z
      .boolean()
      .optional()
      .describe("Require a valid Supabase JWT to invoke (default true)"),
  }),
  async run(context, input): Promise<ToolResult> {
    let source: string;
    try {
      source = (await context.runtime.readFile(context.projectId, input.path)).content;
    } catch {
      return { output: `Could not read ${input.path}.`, isError: true };
    }
    try {
      const { ok, status, json } = await bridgeCall(context, "deploy-function", {
        slug: input.slug,
        source,
        ...(input.verifyJwt === undefined ? {} : { verifyJwt: input.verifyJwt }),
      });
      if (!ok) {
        const message =
          (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${status}`;
        return { output: truncate(message, 2000), isError: true };
      }
      const { slug, created } = json as { slug: string; created: boolean };
      return {
        output: `Edge Function "${slug}" ${created ? "created and deployed" : "updated and redeployed"} on the linked Supabase development project.`,
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },
});

export const supabaseVerifyBackendTool = defineTool({
  name: "supabase_verify_backend",
  description:
    "Check the applied Supabase schema: row-level security is on every table, each table has " +
    "policies, and the public roles are not over-granted. Returns PASS/FAIL per check plus an " +
    "informational note on the auth signup flow. Run it after supabase_apply_migration and fix " +
    "any FAIL. Only available when a Supabase backend is linked.",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    try {
      const { ok, status, json } = await bridgeCall(context, "verify", {});
      if (!ok) {
        const message =
          (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${status}`;
        return { output: `Verification failed to run: ${truncate(message, 2000)}`, isError: true };
      }
      const result = json as {
        verified: boolean;
        summary: string;
        checks: Array<{ name: string; status: string; detail: string }>;
      };
      const lines = result.checks
        .map((c) => `${c.status.toUpperCase()} — ${c.name}: ${c.detail}`)
        .join("\n");
      return {
        output: `${result.summary}\n${lines}`,
        isError: !result.verified,
      };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },
});
