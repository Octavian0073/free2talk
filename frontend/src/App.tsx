import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { WebSocketProvider } from './context/WebSocketContext'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'

// AdminDashboard is lazy-loaded so it is never bundled into the main chunk.
// In production: it becomes a separate code-split chunk that is only
// fetched by the browser when an authenticated admin reaches /admin.
// Non-admin users never download admin code, endpoint paths, or UI logic.
// In development: the module is fetched on-demand when the route renders,
// which only happens after AdminRoute confirms is_admin === true in the DB.
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-white text-sm">
      Loading...
    </div>
  )
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

// AdminRoute performs two checks before rendering children:
// 1. User must be authenticated (valid JWT + DB existence check via getMe)
// 2. User must have is_admin === true (sourced from DB via getMe, never from JWT)
// Only after both pass does React trigger the lazy import for AdminDashboard.
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (!user.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? <Navigate to="/" replace /> : <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <WebSocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/admin"    element={
            <AdminRoute>
              {/* Suspense is required by React.lazy — shows Spinner while the
                  admin chunk downloads. Only reached if AdminRoute passes. */}
              <Suspense fallback={<Spinner />}>
                <AdminDashboard />
              </Suspense>
            </AdminRoute>
          } />
          <Route path="/"         element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </WebSocketProvider>
    </AuthProvider>
  )
}
