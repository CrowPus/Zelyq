import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui";
import { useSession } from "./hooks/useSession";
import { ProjectEditorPage } from "./pages/ProjectEditorPage";
import { ProjectListPage } from "./pages/ProjectListPage";
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

/**
 * One gate in front of everything. The server enforces access on every route
 * regardless — this only decides which screen to render, so a stale client can
 * never become an authorisation bypass.
 */
function Gate() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="grid h-dvh place-items-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  if (!user) return <SignInPage />;

  return (
    <Routes>
      <Route path="/" element={<ProjectListPage />} />
      <Route path="/projects/:id" element={<ProjectEditorPage />} />
      <Route path="/teams/:id" element={<TeamPage />} />
    </Routes>
  );
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
