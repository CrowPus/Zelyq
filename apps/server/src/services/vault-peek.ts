import { AsyncLocalStorage } from "node:async_hooks";

const peeking = new AsyncLocalStorage<true>();

/**
 * Runs `work` without counting its Vault reads as uses: for screens that only
 * show whether a secret is set, and checks made while setting something up.
 * Every other read is a real use and updates the secret's "last used".
 */
export function peekVault<T>(work: () => Promise<T>): Promise<T> {
  return peeking.run(true, work);
}

export function isPeekingVault(): boolean {
  return peeking.getStore() === true;
}
