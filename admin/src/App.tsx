import { useEffect, useState } from 'react'
import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './api'
import { LoginPage } from './LoginPage'
import { MonthBoard } from './MonthBoard'
import { PlayerPhotosPage } from './PlayerPhotosPage'
import { PuzzleEditorPage } from './PuzzleEditorPage'
import { OpsShell } from './components/OpsShell'

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
})

function AppShell() {
  const [adminName, setAdminName] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    api
      .me()
      .then((r) => setAdminName(r.name))
      .catch(() => setAdminName(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return <div className="login-page muted">Checking session…</div>
  }

  if (!adminName) {
    return <LoginPage onLoggedIn={setAdminName} />
  }

  return (
    <OpsShell
      adminName={adminName}
      onLogout={() => {
        void api.logout().finally(() => setAdminName(null))
      }}
    >
      <Outlet />
    </OpsShell>
  )
}

function AdminHome() {
  return <MonthBoard />
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route element={<AppShell />}>
        <Route path="/" element={<AdminHome />} />
        <Route path="/player-photos" element={<PlayerPhotosPage />} />
        <Route path="/d/:date/:modeId" element={<PuzzleEditorPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </>
  ),
  { basename: '/admin' }
)

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
