import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spinner } from "./components/ui";
import { useSession } from "./hooks/useSession";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectEditorPage } from "./pages/ProjectEditorPage";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { TeamPage } from "./pages/TeamPage";

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

/**
 * Signing in and out is a change of address, not a swap of component.
 *
 * Rendering the sign-in screen in place of the app left the URL pointing at a
 * page the visitor could no longer see: the back button did nothing useful, the
 * address bar lied, and a reload was needed before anything looked right.
 *
 * Redirecting is declarative on purpose. Any route becoming unauthorised — a
 * sign-out, an expired session, a revoked one — lands on the same screen
 * without a single call site having to remember to navigate.
 */
function Gate() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path={SIGN_IN_PATH} element={<SignInPage />} />
        <Route
          path="*"
          element={
            // Remember where they were headed, so signing in can return them.
            <Navigate
              to={SIGN_IN_PATH}
              replace
              state={{ from: location.pathname + location.search }}
            />
          }
        />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Already signed in: go on to whatever they were trying to reach. */}
      <Route path={SIGN_IN_PATH} element={<AfterSignIn />} />
      <Route path="/" element={<ProjectListPage />} />
      <Route path="/projects/:id" element={<ProjectEditorPage />} />
      <Route path="/teams/:id" element={<TeamPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/account" element={<ProfilePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Where to land once signed in.
 *
 * The destination is read here rather than navigated to from the sign-in form:
 * the form's own `navigate` raced this route's redirect, and which one won
 * depended on how quickly the session query resolved. Deciding in one place
 * removes the race.
 */
function AfterSignIn() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from && !from.startsWith(SIGN_IN_PATH) ? from : "/";
  return <Navigate to={destination} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
