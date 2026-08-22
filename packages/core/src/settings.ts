import { z } from "zod";

/**
 * How a setting is edited in the UI. `secret` is write-only: the server returns
 * whether one is configured, never the value.
 */
export const settingKindSchema = z.enum(["text", "secret", "number", "boolean", "select"]);
export type SettingKind = z.infer<typeof settingKindSchema>;

/** Where the effective value came from. */
export const settingSourceSchema = z.enum(["env", "database", "default"]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

export const settingFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  kind: settingKindSchema,
  group: z.string(),
  /** Absent for secrets, which are never sent back. */
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  /** Secrets only: whether a value is stored, and its last few characters. */
  configured: z.boolean().optional(),
  hint: z.string().optional(),
  source: settingSourceSchema,
  /** The variable that overrides this setting, and locks it when present. */
  envVar: z.string(),
  /** True when the environment supplies it, so the UI must not offer editing. */
  managedByEnv: z.boolean(),
  /** Changing it only takes effect after the process restarts. */
  restartRequired: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
});
export type SettingField = z.infer<typeof settingFieldSchema>;

export const settingsGroupSchema = z.object({
  name: z.string(),
  description: z.string(),
  fields: z.array(settingFieldSchema),
});
export type SettingsGroup = z.infer<typeof settingsGroupSchema>;

export const settingsResponseSchema = z.object({
  groups: z.array(settingsGroupSchema),
  /** True when at least one changed setting needs a restart to take effect. */
  restartPending: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

/**
 * A write. An empty string clears a stored value and falls back to the
 * environment or the default.
 */
export const updateSettingsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
