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
const Generate = lazy(() import => import("./pages/Generate.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Datasets = lazy(() => import("./pages/Datasets.tsx"));
const Jobs = lazy(() => import("./pages/Jobs.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
