/** The minimal shape a setting resolution needs — enough to read a stored
 * value, nothing about how it got there or who else can write it. */
export interface SettingsReader {
  get(key: string): Promise<string | null>;
}

/**
 * The one implementation of "how a setting resolves" — environment beats
 * database beats default, unless the setting is explicitly overridable —
 * shared by every process that needs a boot-time value from the same store
 * the server owns.
 *
 * See `034` in the council notes: before this, `SettingsService` (in
 * `apps/server`) had its own copy of this rule and nothing else did, which
 * is how a setting could be stored correctly in the database and still
 * never reach a process — the agent, `apps/runtime-host` — that isn't the
 * server and has no other way to learn it changed.
 *
 * `envOverridable` inverts the order for a setting where locking it to
 * whatever the environment says is not actually protecting anything — see
 * `041`. Every caller of this function already requires an instance admin
 * to read or write the value, so "an operator set this on purpose" and
 * "someone is changing it from the UI" are the same person for these
 * fields; the environment is only ever their bootstrap default, not a lock
 * they need protecting from themselves.
 */
export async function resolveSetting(
  settings: SettingsReader,
  envVar: string,
  dbKey: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
  envOverridable = false,
): Promise<string> {
  if (envOverridable) {
    const stored = await settings.get(dbKey);
    if (stored !== null) return stored;
    return env[envVar] || fallback;
  }

  const fromEnv = env[envVar];
  if (fromEnv) return fromEnv;
  const stored = await settings.get(dbKey);
  return stored ?? fallback;
}
