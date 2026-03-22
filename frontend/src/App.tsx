import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { WebSocketProvider } from './context/WebSocketContext'
import { UILangProvider } from './context/UILangContext'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Landing from './pages/Landing'
import Profile from './pages/Profile'

const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-white text-sm">
      Loading...
    </div>
  )
}

// Root route: landing for guests, chat for authenticated users.
function RootRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? <Dashboard /> : <Landing />
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return user ? <>{children}</> : <Navigate to="/" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/" replace />
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
    <UILangProvider>
    <AuthProvider>
      <WebSocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"         element={<RootRoute />} />
          <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/profile"  element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/admin"    element={
            <AdminRoute>
              <Suspense fallback={<Spinner />}>
                <AdminDashboard />
              </Suspense>
            </AdminRoute>
          } />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </WebSocketProvider>
    </AuthProvider>
    </UILangProvider>
  )
}
