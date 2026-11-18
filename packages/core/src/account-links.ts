// No zod here: the web app reads these before anything else loads.

/** An outside account service (see account-service.ts for its schema). */
export interface AccountService {
  /** Shown on buttons: "Continue with <name>". */
  name: string;
  /** The service's address, no trailing slash. */
  url: string;
}

export interface AccountServiceLinks {
  signup(returnTo?: string): string;
  account(): string;
  billing(teamId: string): string;
  upgrade(teamId: string, limit?: string): string;
  signout(returnTo?: string): string;
}

/** The service's pages, from its address. */
export function accountServiceLinks(service: AccountService): AccountServiceLinks {
  let base = service.url;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const at = (path: string, query: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    const search = params.toString();
    return `${base}${path}${search ? `?${search}` : ""}`;
  };
  return {
    signup: (returnTo) => at("/signup", { return_to: returnTo }),
    account: () => at("/account"),
    billing: (teamId) => at("/billing", { team: teamId }),
    upgrade: (teamId, limit) => at("/upgrade", { team: teamId, limit }),
    signout: (returnTo) => at("/signout", { return_to: returnTo }),
  };
}
