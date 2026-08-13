import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import ReleaseCenterPage from './pages/ReleaseCenterPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return <Layout><Routes>
    <Route path="/" element={<DashboardPage />} />
    <Route path="/projects" element={<ProjectsPage />} />
    <Route path="/projects/:id" element={<ProjectPage />} />
    <Route path="/runs" element={<DashboardPage runsOnly />} />
    <Route path="/releases" element={<ReleaseCenterPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Layout>;
}
