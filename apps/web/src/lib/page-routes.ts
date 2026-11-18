/**
 * Which page an address opens, so index.html can start fetching that page's
 * code before the app has even run (see vite.config.ts, preloadPages). Only a
 * head start: App.tsx's routes still decide what is shown, and an address
 * missing here just loads the usual way. First match wins.
 *
 * The third item: API reads that page makes first and that need nothing but
 * the signed-in person, started at once too (lib/api.ts takes them).
 */
export const PAGE_ROUTES: ReadonlyArray<
  readonly [pattern: string, page: string | null, early?: readonly string[]]
> = [
  // Signed-out screens.
  ["^/signin/?$", "SignInPage", ["/auth/status"]],
  ["^/(reset-password|invite)/?$", "EmailLinkPages"],
  // Old addresses that only redirect.
  [
    "^/(signin|reset-password|invite|dev|settings|projects|teams|image-studio|video-studio|studio|vault|agents|pipelines|deployments|ops)(/|$)",
    null,
  ],
  ["^/account/?$", "ProfilePage"],
  ["^/admin/?$", "SettingsPage"],
  ["^/docs/?$", "DocsPage"],
  ["^/[^/]*/?$", "HomePage", ["/projects"]],
  ["^/[^/]+/apps/?$", "ProjectListPage", ["/projects"]],
  ["^/[^/]+/apps/[^/]+/(overview|settings)/?$", "AppDetailPage"],
  ["^/[^/]+/apps/[^/]+/?$", "ProjectEditorPage"],
  ["^/[^/]+/members/?$", "TeamPage"],
  ["^/[^/]+/settings/?$", "TeamSettingsPage"],
  ["^/[^/]+/studio(/image)?/?$", "ImageStudioPage"],
  ["^/[^/]+/studio/video/?$", "VideoStudioPage"],
  ["^/[^/]+/vault/?$", "VaultPage"],
  ["^/[^/]+/agents/?$", "AgentsPage"],
  ["^/[^/]+/pipelines/?$", "PipelinesPage"],
  ["^/[^/]+/pipelines/[^/]+/runs/[^/]+/?$", "PipelineRunPage"],
  ["^/[^/]+/pipelines/[^/]+/?$", "PipelinePage"],
  ["^/[^/]+/deployments/?$", "DeploymentsPage"],
  ["^/[^/]+/deployments/[^/]+/apps/[^/]+/?$", "AppPage"],
  ["^/[^/]+/ops/?$", "OpsPage"],
];
