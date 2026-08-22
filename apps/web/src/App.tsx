import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProjectEditorPage } from "./pages/ProjectEditorPage";
import { ProjectListPage } from "./pages/ProjectListPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The WebSocket already pushes what changes; polling on window focus
      // would just add noise.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectEditorPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
