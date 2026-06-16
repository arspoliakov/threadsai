import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import SeoAnalytics from "./components/SeoAnalytics";
import ProtectedRoute from "./ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import TermsPage from "./pages/TermsPage";
import NotFoundPage from "./pages/NotFoundPage";
import PrivacyPage from "./pages/PrivacyPage";
import LoginPage from "./pages/auth/LoginPage";
import { seoLandingRoutePaths } from "./seo/routes";

const SeoHead = lazy(() => import("./components/SeoHead"));
const SeoLandingPage = lazy(() => import("./pages/seo/SeoLandingPage"));
const ArticlePage = lazy(() => import("./pages/seo/ArticlePage"));
const GlobalLayout = lazy(() => import("./layouts/GlobalLayout"));
const ProjectLayout = lazy(() => import("./layouts/ProjectLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const InfrastructurePage = lazy(() => import("./pages/global/InfrastructurePage"));
const GlobalSettingsPage = lazy(() => import("./pages/global/GlobalSettingsPage"));
const HowItWorksPage = lazy(() => import("./pages/global/HowItWorksPage"));
const ProjectOverviewPage = lazy(() => import("./pages/project/ProjectOverviewPage"));
const ProjectQueuePage = lazy(() => import("./pages/project/ProjectQueuePage"));
const ProjectTrendsPage = lazy(() => import("./pages/project/ProjectTrendsPage"));
const ProjectSettingsPage = lazy(() => import("./pages/project/ProjectSettingsPage"));

export default function App() {
  return (
    <>
      <Suspense fallback={null}><SeoHead /></Suspense>
      <SeoAnalytics />
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          className:
            "rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] text-[#151515] shadow-sm",
        }}
      />
      <Suspense fallback={<div className="min-h-screen bg-[#f5f6f1]" />}>
        <Routes>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        {seoLandingRoutePaths.map((path) => (
          <Route key={path} path={path} element={<SeoLandingPage />} />
        ))}
        <Route path="blog/*" element={<ArticlePage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="app" element={<GlobalLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="how-it-works" element={<HowItWorksPage />} />
            <Route path="infrastructure" element={<InfrastructurePage />} />
            <Route path="settings" element={<GlobalSettingsPage />} />
          </Route>

          <Route path="app/projects/:id" element={<ProjectLayout />}>
            <Route index element={<ProjectOverviewPage />} />
            <Route path="queue" element={<ProjectQueuePage />} />
            <Route path="trends" element={<ProjectTrendsPage />} />
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
        </Route>

        <Route path="infrastructure" element={<Navigate to="/app/infrastructure" replace />} />
        <Route path="settings" element={<Navigate to="/app/settings" replace />} />
        <Route path="projects/:id/*" element={<Navigate to="/app" replace />} />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
