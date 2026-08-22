import { LocalRuntimeDriver } from "./local.js";
import { RemoteRuntimeDriver } from "./remote.js";
import type { RuntimeConfig, RuntimeDriver } from "./types.js";

export { defaultWorkspaceDir, LocalRuntimeDriver } from "./local.js";
export {
  assertRealPathInside,
  DEFAULT_IGNORED,
  isIgnored,
  resolveInside,
  toPosix,
} from "./paths.js";
export { allocatePort, releasePort, waitForPort } from "./ports.js";
export { RemoteRuntimeDriver } from "./remote.js";
export * from "./types.js";

/**
 * The one place that decides where code runs. Callers take a `RuntimeDriver`
 * and never learn which implementation they got.
 */
export function createRuntimeDriver(config: RuntimeConfig): RuntimeDriver {
  switch (config.kind) {
    case "local":
      return new LocalRuntimeDriver(config);
    case "remote":
      return new RemoteRuntimeDriver(config);
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Unknown runtime kind: ${String(exhaustive)}`);
    }
  }
}
