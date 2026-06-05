import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import GlobalLayout from "./layouts/GlobalLayout";
import ProjectLayout from "./layouts/ProjectLayout";
import ProtectedRoute from "./ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import BillingPage from "./pages/BillingPage";
import LandingPage from "./pages/LandingPage";
import TermsPage from "./pages/TermsPage";
import LoginPage from "./pages/auth/LoginPage";
import InfrastructurePage from "./pages/global/InfrastructurePage";
import GlobalSettingsPage from "./pages/global/GlobalSettingsPage";
import HowItWorksPage from "./pages/global/HowItWorksPage";
import ProjectOverviewPage from "./pages/project/ProjectOverviewPage";
import ProjectQueuePage from "./pages/project/ProjectQueuePage";
import ProjectTrendsPage from "./pages/project/ProjectTrendsPage";
import ProjectSettingsPage from "./pages/project/ProjectSettingsPage";

export default function App() {
  return (
    <>
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          className:
            "rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] text-[#151515] shadow-sm",
        }}
      />
      <Routes>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="terms" element={<TermsPage />} />

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
