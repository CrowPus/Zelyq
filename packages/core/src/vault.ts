import { z } from "zod";

/**
 * Vault — a team's secrets (and the instance's own credentials), one value
 * per name, as a module of its own. Everything else uses it: a coding
 * project's variables, Settings fields, and outside systems through service
 * keys. Vault is optional everywhere: a credential can always be typed
 * where it is used instead.
 *
 * A value is write-only on every path except an explicit, audited reveal.
 * The types below are what everything else sees: names, who changed what
 * and when, where a secret is used — never a value.
 */

/** Versions kept per secret or typed variable; the oldest drop off. */
export const VAULT_VERSIONS_KEPT = 20;
export const VAULT_VALUE_MAX_LENGTH = 16_000;

/**
 * Variable names Zelyq sets itself, or that would reach the browser bundle.
 * A variable named `VITE_…` is compiled into the JavaScript every visitor
 * downloads, so refusing the prefix is what keeps a secret a secret. The rest
 * are set from the project's backend configuration and must not be silently
 * overridden.
 */
export const RESERVED_ENV_NAME =
  /^(?:ZELYQ_|VITE_|EXPO_|NODE_|PYTHON|UV_|PATH$|HOME$|LD_|DYLD_|DATABASE_|AUTH_|SUPABASE_)/;

/**
 * A Vault secret's name. Looser than a variable name — `vault://` references
 * and outside systems use it, not a process environment — but still plain
 * enough to type, to put in a URL path, and to match with a `*` pattern.
 */
export const vaultNameSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/,
    "Start with a letter; use letters, digits, '_', '-' and '.' (for example STRIPE_KEY_LIVE).",
  );

/** A project variable's name: what the app reads from its environment. */
export const variableNameSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]{0,63}$/,
    "Use capital letters, digits and underscores, starting with a letter (for example STRIPE_KEY).",
  )
  .refine((name) => !RESERVED_ENV_NAME.test(name), {
    message:
      "That name is reserved: Zelyq sets it, or it would be published to the browser. Choose another.",
  });

const valueSchema = z
  .string()
  .min(1, "A secret needs a value.")
  .max(VAULT_VALUE_MAX_LENGTH, `A value can be at most ${VAULT_VALUE_MAX_LENGTH} characters.`);
const descriptionSchema = z.string().trim().max(500).nullable();

// ---------------------------------------------------------------------------
// Vault entries
// ---------------------------------------------------------------------------

export type VaultScope = { kind: "team"; teamId: string } | { kind: "instance" };

export const vaultEntryCreateSchema = z
  .object({
    name: vaultNameSchema,
    value: valueSchema,
    description: descriptionSchema.optional(),
    protected: z.boolean().optional(),
  })
  .strict();
export type VaultEntryCreate = z.infer<typeof vaultEntryCreateSchema>;

export const vaultEntryUpdateSchema = z
  .object({
    value: valueSchema.optional(),
    description: descriptionSchema.optional(),
    protected: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Nothing to change.",
  });
export type VaultEntryUpdate = z.infer<typeof vaultEntryUpdateSchema>;

export interface VaultActor {
  id: string;
  name: string;
}

/** Where a Vault secret is used, so a delete can say what it would break. */
export type VaultUsage =
  | { kind: "project"; projectId: string; projectName: string; variable: string }
  | { kind: "setting"; key: string; label: string };

/** A Vault secret as everyone but an audited reveal sees it. No value field. */
export interface VaultEntry {
  id: string;
  scope: "team" | "instance";
  teamId: string | null;
  name: string;
  description: string | null;
  protected: boolean;
  version: number;
  usedBy: VaultUsage[];
  createdBy: VaultActor | null;
  updatedBy: VaultActor | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultVersion {
  version: number;
  current: boolean;
  createdBy: VaultActor | null;
  createdAt: string;
}

export interface VaultImportResult {
  created: string[];
  updated: string[];
  skipped: { name: string; reason: string }[];
}

export const vaultImportSchema = z
  .object({ content: z.string().max(200_000), overwrite: z.boolean().default(false) })
  .strict();
export type VaultImport = z.input<typeof vaultImportSchema>;

export const vaultRollbackSchema = z.object({ version: z.number().int().positive() }).strict();

// ---------------------------------------------------------------------------
// Project variables
// ---------------------------------------------------------------------------

/** Typed here, or taken from the project's team Vault — the two ways. */
export const projectVariableCreateSchema = z.union([
  z
    .object({
      name: variableNameSchema,
      value: valueSchema,
      description: descriptionSchema.optional(),
    })
    .strict(),
  z
    .object({
      name: variableNameSchema,
      vaultName: vaultNameSchema,
      description: descriptionSchema.optional(),
    })
    .strict(),
]);
export type ProjectVariableCreate = z.infer<typeof projectVariableCreateSchema>;

/** Give a new typed value, point it at Vault instead, or change the note.
 * `value` and `vaultName` are the two sources, so at most one is given. */
export const projectVariableUpdateSchema = z
  .object({
    value: valueSchema.optional(),
    vaultName: vaultNameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()
  .refine((input) => !(input.value !== undefined && input.vaultName !== undefined), {
    message: "Give a value or a Vault secret, not both.",
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Nothing to change.",
  });
export type ProjectVariableUpdate = z.infer<typeof projectVariableUpdateSchema>;

export interface ProjectVariable {
  id: string;
  projectId: string;
  name: string;
  source: "direct" | "vault";
  /** For a Vault variable: which secret it points at. */
  vaultName: string | null;
  /** A Vault variable whose secret is no longer in Vault. The app does not get it. */
  missing: boolean;
  /** A Vault variable pointing at a Protected secret. */
  protected: boolean;
  description: string | null;
  version: number;
  createdBy: VaultActor | null;
  updatedBy: VaultActor | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Service keys
// ---------------------------------------------------------------------------

export const VAULT_KEY_SCOPES = ["list", "read", "write", "pipelines"] as const;
export const vaultKeyScopeSchema = z.enum(VAULT_KEY_SCOPES);
export type VaultKeyScope = z.infer<typeof vaultKeyScopeSchema>;

/** `STRIPE_*`-style patterns: letters, digits, `_ - .` and `*` only. */
const namePatternSchema = z.string().regex(/^[A-Za-z0-9_.*-]{1,128}$/, "Invalid name pattern.");

export const vaultServiceKeyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(vaultKeyScopeSchema).min(1),
    namePatterns: z.array(namePatternSchema).max(50).nullable().optional(),
    allowedIps: z.array(z.string().max(64)).max(50).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type VaultServiceKeyCreate = z.infer<typeof vaultServiceKeyCreateSchema>;

export interface VaultServiceKey {
  id: string;
  teamId: string;
  name: string;
  /** Enough to recognise a key in a list or a log, never to use it. */
  keyPrefix: string;
  scopes: VaultKeyScope[];
  namePatterns: string[] | null;
  allowedIps: string[] | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdBy: VaultActor | null;
  createdAt: string;
}

/** The only time a key is ever shown. */
export interface VaultServiceKeyCreated {
  key: VaultServiceKey;
  secret: string;
}

/** Shell-style `*` match, anchored, with no regular expression built from input. */
export function matchesNamePattern(name: string, pattern: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return name === pattern;
  const first = parts[0] as string;
  const last = parts[parts.length - 1] as string;
  if (!name.startsWith(first) || name.length < first.length + last.length) return false;
  if (!name.endsWith(last)) return false;
  let at = first.length;
  const end = name.length - last.length;
  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, at);
    if (found === -1 || found + middle.length > end) return false;
    at = found + middle.length;
  }
  return true;
}

// ---------------------------------------------------------------------------
// .env import (a one-time way to move existing keys in)
// ---------------------------------------------------------------------------

/**
 * Reads `KEY=VALUE` lines the way a `.env` file is written in practice:
 * comments, blank lines, `export KEY=…`, and single- or double-quoted values
 * (double quotes understand `\n`). Lines that are not an assignment come back
 * as `invalid` rather than being dropped, so an import can say what it did not
 * take. A later line for the same name wins, as it does when a shell sources
 * the file.
 */
export function parseDotEnv(content: string): {
  entries: { name: string; value: string }[];
  invalid: string[];
} {
  const values = new Map<string, string>();
  const invalid: string[] = [];
  // No regular expression here may backtrack: a pasted file is untrusted input,
  // and a pattern like `\s*=\s*(.*)` takes quadratic time on a line of spaces.
  // Splitting on the first `=` and searching for fixed-width markers is linear.
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    let name = equals > 0 ? line.slice(0, equals).trim() : "";
    if (name.startsWith("export ") || name.startsWith("export\t")) name = name.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
      invalid.push(line.length > 40 ? `${line.slice(0, 40)}…` : line);
      continue;
    }
    let value = line.slice(equals + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2) {
      const end = value.lastIndexOf(quote);
      if (end > 0) {
        value = value.slice(1, end);
        if (quote === '"') value = value.replaceAll("\\n", "\n").replaceAll('\\"', '"');
      }
    } else {
      // An unquoted value ends at an inline comment: a `#` after whitespace.
      const comment = /\s#/.exec(value);
      if (comment) value = value.slice(0, comment.index).trim();
    }
    values.set(name, value);
  }
  return { entries: [...values].map(([name, value]) => ({ name, value })), invalid };
}
