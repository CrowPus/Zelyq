import { z } from "zod";

const relativePath = z
  .string()
  .max(240)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.split("/").includes("..") &&
      !/^[a-z]:/i.test(value),
    "Expected a project-relative path",
  );
const command = z
  .object({
    command: z.string().min(1).max(4000),
    cwd: relativePath.default("."),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
  })
  .strict();

export const projectRuntimeSchema = z
  .object({
    version: z.literal(1),
    stack: z.literal("react-fastapi"),
    install: z.array(command).min(1).max(8),
    services: z
      .array(
        z
          .object({
            id: z.enum(["backend", "frontend"]),
            cwd: relativePath.default("."),
            argv: z.array(z.string().min(1).max(1000)).min(1).max(30),
            healthPath: z.string().startsWith("/").max(200),
          })
          .strict(),
      )
      .length(2)
      .refine(
        (services) => services[0]?.id === "backend" && services[1]?.id === "frontend",
        "Declare backend then frontend",
      ),
    /**
     * Brought up to date before the API starts, but only for a database the
     * application owns and Zelyq created — the local build database. The
     * runtime decides whether to run it; a user's own PostgreSQL or MySQL is
     * never migrated automatically, however this is declared.
     */
    migrate: command.optional(),
    checks: z
      .array(command.extend({ name: z.string().min(1).max(100) }))
      .min(1)
      .max(12),
  })
  .strict();
export type ProjectRuntimeManifest = z.infer<typeof projectRuntimeSchema>;

/**
 * One service's status as the supervisor records it.
 *
 * The supervisor writes this file inside the project, so it is read back as
 * untrusted input: the ids are the two the manifest allows, the status is a
 * known state, and `lastError` is bounded because it reaches both the editor
 * and the agent's context.
 */
export const serviceStatusSchema = z
  .object({
    id: z.enum(["backend", "frontend"]),
    status: z.enum(["starting", "running", "crashed", "stopped"]),
    lastError: z.string().max(2000).nullable().catch(null),
  })
  .strict();

export const managedServiceStateSchema = z
  .object({ services: z.array(serviceStatusSchema).max(2) })
  .strict();

export const backendConfigurationSchema = z
  .object({
    engine: z.enum(["none", "sqlite", "postgresql", "mysql", "supabase"]).default("none"),
    ownership: z.enum(["external", "application"]).default("external"),
    schema: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .max(63)
      .optional(),
    tables: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
          .max(128),
      )
      .max(50)
      .default([]),
    /**
     * Left unsaid, this follows ownership rather than defaulting to `true`:
     * read-only exists to protect data somebody else owns. An application's own
     * schema defaulting to read-only just means the app cannot save anything.
     */
    readOnly: z.boolean().optional(),
    auth: z.enum(["none", "jwt"]).default("none"),
    issuer: z.string().url().optional(),
    audience: z.string().min(1).max(300).optional(),
    jwksUrl: z.string().url().optional(),
    // Values are write-only. Undefined preserves; null clears.
    databaseUrl: z.string().max(4000).nullable().optional(),
    secrets: z
      .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(16000).nullable())
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.auth === "jwt" && (!value.issuer || !value.audience || !value.jwksUrl)) {
      ctx.addIssue({
        code: "custom",
        message: "JWT authentication requires issuer, audience and JWKS URL",
      });
    }
  })
  .transform((value) => ({
    ...value,
    readOnly: value.readOnly ?? value.ownership === "external",
  }));
export type BackendConfigurationInput = z.input<typeof backendConfigurationSchema>;
/** After parsing: every default filled in, `readOnly` resolved from ownership. */
export type BackendConfigurationResolved = z.output<typeof backendConfigurationSchema>;
export type BackendConfiguration = Omit<
  z.output<typeof backendConfigurationSchema>,
  "databaseUrl" | "secrets"
> & {
  configured: boolean;
  secretNames: string[];
  revision: string;
};

/**
 * What a Python project has before anyone configures anything: its own SQLite
 * database, in the project's runtime-data directory, that it may read and write
 * and own the schema of.
 *
 * A build tool has to be able to save data the moment a project exists. Making
 * persistence a configuration step means the first app anyone asks for — the
 * one with a list of things in it — cannot work until they go and find a
 * database, which is not how anybody builds. Connecting PostgreSQL or MySQL is
 * an upgrade from here, not the price of entry.
 */
export const LOCAL_DEVELOPMENT_DATABASE = {
  engine: "sqlite",
  ownership: "application",
  readOnly: false,
} as const;
