import { z } from "zod";

/**
 * Managed mode: a server connected to an outside account service, which owns
 * sign-up, sign-in, profile and billing for its people (a hosted offering, or a
 * company's own portal). A self-hosted server has none, and nothing here shows.
 *
 * The service is reached by fixed paths on its address, so any service can
 * implement the same contract (docs/managed-mode.md):
 *
 *   /signup?return_to=…                      create an account
 *   /account                                 the person's own account page
 *   /billing?team=<teamId>                   change a team's plan
 *   /upgrade?team=<teamId>&limit=<key>       after a plan limit stopped something
 *   /signout?return_to=…                     sign out of the service as well
 */
export const accountServiceSchema = z.object({
  /** Shown on buttons: "Continue with <name>". */
  name: z.string(),
  /** The service's address, no trailing slash. */
  url: z.string().url(),
});
export type { AccountService } from "./account-links.js";

/**
 * What this server offers, asked by the sign-in screen before anyone signs in.
 * The browser never guesses: it shows only what this answer says.
 */
export const instanceStatusSchema = z.object({
  firstRun: z.boolean(),
  /** Kept for older clients: same as `signIn.oidc`. */
  oidcEnabled: z.boolean(),
  /** Kept for older clients: same as `signIn.passwordReset`. */
  passwordReset: z.boolean(),
  mode: z.enum(["self_hosted", "managed"]),
  /** The account service, when managed. */
  accounts: accountServiceSchema.nullable(),
  signIn: z.object({
    /** The email + password form. In managed mode only for the server's own administrators. */
    password: z.boolean(),
    /** This server's own "Create account" form. */
    register: z.boolean(),
    passwordReset: z.boolean(),
    oidc: z.boolean(),
    /** Sign-in is the account service's alone. */
    oidcOnly: z.boolean(),
    oidcLabel: z.string(),
  }),
});
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;
