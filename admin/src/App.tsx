import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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

  return (
    <Routes>
      <Route
        path="/"
        element={
          <MonthBoard
            adminName={adminName}
            onLogout={() => {
              void api.logout().finally(() => setAdminName(null))
            }}
          />
        }
      />
      <Route path="/d/:date/:modeId" element={<PuzzleEditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename="/admin">
        <AppShell />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
