import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import {
  buttonClass,
  ConfirmHost,
  EmptyState,
  ErrorBoundary,
  Spinner,
  TitleTooltips,
  Toaster,
  TooltipProvider,
} from "./components/ui";
import { useActiveTeam } from "./hooks/useActiveTeam";
import { useSession } from "./hooks/useSession";
import { setFormatPreferences } from "./lib/format";
import { followAccountLanguage, t } from "./lib/i18n";
import { setCurrentTeamKey, teamKey, teamPaths, useRouteTeam } from "./lib/routes";
import { InvitePage, ResetPasswordPage } from "./pages/EmailLinkPages";
import { SignInPage } from "./pages/SignInPage";

/*
 * Pages load on demand, so the first visit downloads the shell and the page
 * it asked for — not the code editor, the pipeline canvas and the studios.
 */
// biome-ignore lint/suspicious/noExplicitAny: a page module's exports are only known by name.
const page = <P = object>(load: () => Promise<any>, name: string) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType<P> }));

const HomePage = page(() => import("./pages/HomePage"), "HomePage");
const ProjectListPage = page(() => import("./pages/ProjectListPage"), "ProjectListPage");
const ProjectEditorPage = page(() => import("./pages/ProjectEditorPage"), "ProjectEditorPage");
const AppDetailPage = page<{ tab: "overview" | "settings" }>(
  () => import("./pages/AppDetailPage"),
  "AppDetailPage",
);
const TeamPage = page(() => import("./pages/TeamPage"), "TeamPage");
const TeamSettingsPage = page(() => import("./pages/TeamSettingsPage"), "TeamSettingsPage");
const ImageStudioPage = page(() => import("./pages/ImageStudioPage"), "ImageStudioPage");
const VideoStudioPage = page(() => import("./pages/VideoStudioPage"), "VideoStudioPage");
const VaultPage = page(() => import("./pages/VaultPage"), "VaultPage");
const AgentsPage = page(() => import("./pages/AgentsPage"), "AgentsPage");
const PipelinesPage = page(() => import("./pages/PipelinesPage"), "PipelinesPage");
const PipelinePage = page(() => import("./pages/PipelinePage"), "PipelinePage");
const PipelineRunPage = page(() => import("./pages/PipelineRunPage"), "PipelineRunPage");
const DeploymentsPage = page(() => import("./pages/DeploymentsPage"), "DeploymentsPage");
const AppPage = page(() => import("./pages/AppPage"), "AppPage");
const OpsPage = page(() => import("./pages/OpsPage"), "OpsPage");
const DocsPage = page(() => import("./pages/DocsPage"), "DocsPage");
const SettingsPage = page(() => import("./pages/SettingsPage"), "SettingsPage");
const ProfilePage = page(() => import("./pages/ProfilePage"), "ProfilePage");
const GalleryPage = page(() => import("./pages/GalleryPage"), "GalleryPage");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The WebSocket pushes what changes; polling on focus would add noise.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

export const SIGN_IN_PATH = "/signin";

function FullScreenSpinner() {
  return (
    <div className="grid h-dvh place-items-center bg-canvas">
      <Spinner label={t("Loading")} />
    </div>
  );
}

/**
 * Signing in and out is a change of address, not a swap of component: any
 * route becoming unauthorised lands on the same screen, remembering where the
 * person was headed.
 */
function Gate() {
  const { user, loading } = useSession();
  const location = useLocation();
  // Dates and numbers follow the person's own language and time zone.
  useEffect(() => {
    setFormatPreferences({ locale: user?.locale, timeZone: user?.timeZone });
    // So do Zelyq's own words, when the account has chosen a language it speaks.
    followAccountLanguage(user?.locale);
  }, [user?.locale, user?.timeZone]);

  if (loading) return <FullScreenSpinner />;

  if (!user) {
    return (
      <Routes>
        <Route path={SIGN_IN_PATH} element={<SignInPage />} />
        {/* Opened from an emailed link: they work signed in or out. */}
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route
          path="*"
          element={
            <Navigate
              to={SIGN_IN_PATH}
              replace
              state={{ from: location.pathname + location.search + location.hash }}
            />
          }
        />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path={SIGN_IN_PATH} element={<AfterSignIn />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite" element={<InvitePage />} />

        {/* The person's own, the server's, and everyone's. */}
        <Route path="/account" element={<ProfilePage />} />
        <Route path="/admin" element={<SettingsPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/dev/ui" element={<GalleryPage />} />

        {/* Old addresses, so every bookmark, email and Inbox link still lands. */}
        <Route path="/" element={<ToTeam />} />
        <Route path="/settings" element={<ToAdmin />} />
        <Route path="/projects/:id" element={<LegacyApp />} />
        <Route path="/teams/:id" element={<LegacyTeam section="members" />} />
        <Route path="/teams/:id/settings" element={<LegacyTeam section="settings" />} />
        <Route path="/image-studio" element={<ToTeam rest="/studio/image" />} />
        <Route path="/video-studio" element={<ToTeam rest="/studio/video" />} />
        {["studio", "vault", "agents", "pipelines", "deployments", "ops"].map((section) => (
          <Route key={section} path={`/${section}/*`} element={<ToTeam keepPath />} />
        ))}

        {/* Everything a team owns lives under the team. */}
        <Route path="/:team" element={<TeamScope />}>
          <Route index element={<HomePage />} />
          <Route path="apps" element={<ProjectListPage />} />
          <Route path="apps/:id" element={<ProjectEditorPage />} />
          <Route path="apps/:id/overview" element={<AppDetailPage tab="overview" />} />
          <Route path="apps/:id/settings" element={<AppDetailPage tab="settings" />} />
          <Route path="members" element={<TeamPage />} />
          <Route path="settings" element={<TeamSettingsPage />} />
          <Route path="studio" element={<Navigate to="image" replace />} />
          <Route path="studio/image" element={<ImageStudioPage />} />
          <Route path="studio/video" element={<VideoStudioPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="pipelines" element={<PipelinesPage />} />
          <Route path="pipelines/:id" element={<PipelinePage />} />
          <Route path="pipelines/:id/runs/:runId" element={<PipelineRunPage />} />
          <Route path="deployments" element={<DeploymentsPage />} />
          <Route path="deployments/:environmentId/apps/:app" element={<AppPage />} />
          <Route path="ops" element={<OpsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

/**
 * The `/:team` part of every team address. Makes the named team the active
 * one before rendering, so a shared link opens the same view for anyone in
 * that team, and refuses a team the person is not in.
 */
function TeamScope() {
  const routeTeam = useRouteTeam();
  const { team, setTeam } = useActiveTeam();
  const mismatch = routeTeam && team?.id !== routeTeam.id;
  useEffect(() => {
    if (routeTeam && team?.id !== routeTeam.id) setTeam(routeTeam.id);
  }, [routeTeam, team?.id, setTeam]);

  if (!routeTeam) return <NotFound what="team" />;
  if (mismatch) return <FullScreenSpinner />;
  setCurrentTeamKey(teamKey(routeTeam));
  return <Outlet />;
}

/** `/vault?scope=x` → `/default/vault?scope=x`, in the team you were last in. */
function ToTeam({ rest, keepPath }: { rest?: string; keepPath?: boolean }) {
  const { team } = useActiveTeam();
  const location = useLocation();
  if (!team) return <NotFound what="team" />;
  const base = teamPaths(teamKey(team)).home;
  const path = keepPath ? location.pathname : (rest ?? "");
  return <Navigate to={`${base}${path}${location.search}${location.hash}`} replace />;
}

/** `/settings#email` → `/admin#email`: the old server-settings links keep their section. */
function ToAdmin() {
  const location = useLocation();
  return <Navigate to={`/admin${location.search}${location.hash}`} replace />;
}

function LegacyApp() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { team } = useActiveTeam();
  if (!team) return <NotFound what="team" />;
  return (
    <Navigate
      to={`${teamPaths(teamKey(team)).app(id)}${location.search}${location.hash}`}
      replace
    />
  );
}

function LegacyTeam({ section }: { section: "members" | "settings" }) {
  const { id = "" } = useParams();
  const { teams } = useSession();
  const location = useLocation();
  const team = teams.find((t) => t.id === id || t.slug === id);
  if (!team) return <NotFound what="team" />;
  const p = teamPaths(teamKey(team));
  return (
    <Navigate to={`${section === "members" ? p.members : p.settings()}${location.hash}`} replace />
  );
}

function AfterSignIn() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && !from.startsWith(SIGN_IN_PATH) ? from : "/";
  return <Navigate to={destination} replace />;
}

function NotFound({ what = "page" }: { what?: "page" | "team" }) {
  const { team } = useActiveTeam();
  const home = team ? teamPaths(teamKey(team)).home : "/";
  return (
    <AppShell crumbs={[{ label: t("Not found") }]} scope="global">
      <EmptyState
        headingLevel={1}
        title={what === "team" ? t("This team isn’t one of yours") : t("This page doesn’t exist")}
        description={
          what === "team"
            ? t(
                "The link names a team you are not a member of, or one that no longer exists. Ask a team admin to add you.",
              )
            : t("The address may be mistyped, or what it pointed to has been moved or deleted.")
        }
        action={
          <Link to={home} className={buttonClass("primary")}>
            {t("Go to your Home")}
          </Link>
        }
      />
    </AppShell>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          {children}
          <CommandPalette />
          <ConfirmHost />
          <Toaster />
          <TitleTooltips />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <Gate />
      </Providers>
    </ErrorBoundary>
  );
}
