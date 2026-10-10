import { z } from "zod";

/**
 * Vault — a project's secrets, one value per name per environment.
 *
 * A value is write-only on every path except an explicit, audited reveal. The
 * types below are therefore what everything *except* that reveal sees: names,
 * environments, who changed what and when — never a value.
 */

export const VAULT_ENVIRONMENTS = ["development", "test", "production"] as const;
export const vaultEnvironmentSchema = z.enum(VAULT_ENVIRONMENTS);
export type VaultEnvironment = z.infer<typeof vaultEnvironmentSchema>;

/** Versions kept per secret. The oldest is dropped when a write passes this. */
export const VAULT_VERSIONS_KEPT = 20;
export const VAULT_VALUE_MAX_LENGTH = 16_000;

/**
 * Names Zelyq sets itself, or that would reach the browser bundle. A secret
 * named `VITE_…` is compiled into the JavaScript every visitor downloads, so
 * refusing the prefix is what keeps a secret a secret. The rest are set from
 * the project's backend configuration and must not be silently overridden.
 */
export const RESERVED_ENV_NAME =
  /^(?:ZELYQ_|VITE_|EXPO_|NODE_|PYTHON|UV_|PATH$|HOME$|LD_|DYLD_|DATABASE_|AUTH_|SUPABASE_)/;

export const vaultSecretNameSchema = z
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

export const vaultSecretCreateSchema = z
  .object({
    name: vaultSecretNameSchema,
    environment: vaultEnvironmentSchema,
    value: valueSchema,
    description: descriptionSchema.optional(),
  })
  .strict();
export type VaultSecretCreate = z.infer<typeof vaultSecretCreateSchema>;

/** Either field may be left out; at least one must be given. */
export const vaultSecretUpdateSchema = z
  .object({ value: valueSchema.optional(), description: descriptionSchema.optional() })
  .strict()
  .refine((input) => input.value !== undefined || input.description !== undefined, {
    message: "Nothing to change.",
  });
export type VaultSecretUpdate = z.infer<typeof vaultSecretUpdateSchema>;

export const vaultImportSchema = z
  .object({
    environment: vaultEnvironmentSchema,
    content: z.string().max(200_000),
    overwrite: z.boolean().default(false),
  })
  .strict();
export type VaultImport = z.input<typeof vaultImportSchema>;

export const vaultRollbackSchema = z.object({ version: z.number().int().positive() }).strict();

export interface VaultActor {
  id: string;
  name: string;
}

/** A secret as everyone but an audited reveal sees it. There is no value field. */
export interface VaultSecret {
  id: string;
  projectId: string;
  name: string;
  environment: VaultEnvironment;
  description: string | null;
  version: number;
  createdBy: VaultActor | null;
  updatedBy: VaultActor | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultSecretVersion {
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
