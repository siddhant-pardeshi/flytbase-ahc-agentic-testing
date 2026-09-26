import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CockpitPage } from './pages/CockpitPage';
import { HistoryPage } from './pages/HistoryPage';
import { IncidentPage } from './pages/IncidentPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { JoinPage } from './pages/JoinPage';
import { SignInPage } from './pages/SignInPage';
import { useSession } from './auth/session';

function RequireAuth({ children }: { children: ReactElement }) {
  const token = useSession((s) => s.token);
  const restore = useSession((s) => s.restore);
  const location = useLocation();

  useEffect(() => restore(), [restore]);

  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <CockpitPage />
            </RequireAuth>
          }
        />
        <Route
          path="/incidents"
          element={
            <RequireAuth>
              <IncidentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/incident/:id"
          element={
            <RequireAuth>
              <IncidentPage />
            </RequireAuth>
          }
        />
        <Route
          path="/history/:id"
          element={
            <RequireAuth>
              <HistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/join/:token"
          element={
            <RequireAuth>
              <JoinPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/incidents" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
