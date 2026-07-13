import { useEffect, useState } from 'react'
import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useOutletContext,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './api'
import { LoginPage } from './LoginPage'
import { MonthBoard } from './MonthBoard'
import { PuzzleEditorPage } from './PuzzleEditorPage'

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

  return <Outlet context={{ adminName, setAdminName }} />
}

function AdminHome() {
  const { adminName, setAdminName } = useOutletContext<{
    adminName: string
    setAdminName: (name: string | null) => void
  }>()
  return (
    <MonthBoard
      adminName={adminName}
      onLogout={() => {
        void api.logout().finally(() => setAdminName(null))
      }}
    />
  )
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route element={<AppShell />}>
        <Route path="/" element={<AdminHome />} />
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
