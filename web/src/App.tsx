/**
 * Route table (SPEC §6). Public: /login, /board, /board/print, /simulator.
 * Everything else sits behind RequireAuth inside the Layout shell;
 * /analytics and /admin additionally require the committee role (the server
 * enforces the same gates — these are UX affordances, not the security).
 */
import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth, RequireRole } from './auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Feed from './pages/Feed'
import People from './pages/People'
import Board from './pages/Board'
import BoardPrint from './pages/BoardPrint'
import Simulator from './pages/Simulator'

// Chart-heavy / role-gated pages load on demand so the kiosk board and login
// don't pay for recharts and the admin console up front.
const PersonProfile = lazy(() => import('./pages/PersonProfile'))
const Analytics = lazy(() => import('./pages/Analytics'))
const AdminPage = lazy(() => import('./pages/admin/AdminPage'))

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="page-splash">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/board" element={<Board />} />
            <Route path="/board/print" element={<BoardPrint />} />
            <Route path="/simulator" element={<Simulator />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Feed />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<PersonProfile />} />
              <Route
                path="analytics"
                element={
                  <RequireRole role="committee">
                    <Analytics />
                  </RequireRole>
                }
              />
              <Route
                path="admin"
                element={
                  <RequireRole role="committee">
                    <AdminPage />
                  </RequireRole>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
