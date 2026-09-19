import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const StudioLayout = lazy(() => import("@/components/studio/StudioLayout.tsx"));
const Generate = lazy(() => import("./pages/Generate.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Datasets = lazy(() => import("./pages/Datasets.tsx"));
const Jobs = lazy(() => import("./pages/Jobs.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));

// Convex's browser client uses the deployment URL (.convex.cloud).
// VLY/Convex HTTP actions use the separate .convex.site hostname.
// Normalize the latter so an old/downloaded .env.local cannot crash the app.
const configuredConvexUrl =
  import.meta.env.VITE_CONVEX_URL?.trim() ||
  "https://formal-kookabura-53.convex.cloud";

const convexUrl = configuredConvexUrl
  .replace(/\\.convex\\.site\\/?$/i, ".convex.cloud")
  .replace(/\\/$/, "");

const convex = new ConvexReactClient(convexUrl);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

const loadingFallback = (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
  </div>
);

function App() {
  return (
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={loadingFallback}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/generate"
              element={
                <RequireAuth>
                  <Generate />
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <Library />
                </RequireAuth>
              }
            />
            <Route
              path="/datasets"
              element={
                <RequireAuth>
                  <Datasets />
                </RequireAuth>
              }
            />
            <Route
              path="/jobs"
              element={
                <RequireAuth>
                  <Jobs />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </ConvexAuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VlyToolbar />
    <App />
  </StrictMode>,
);
