import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/pages.css'
import { AppProvider } from './lib/store'
import { Shell } from './components/Shell'
import { LogDialog } from './components/LogDialog'
import { Palette } from './components/Palette'
import { HomePage } from './pages/Home'
import { SectionPage } from './pages/Section'
import { WorkPage } from './pages/Work'
import { DiaryPage } from './pages/Diary'
import { RecommendedPage } from './pages/Recommended'
import { InboxPage } from './pages/Inbox'
import { StatsPage } from './pages/Stats'
import { ImportPage } from './pages/Import'
import { SettingsPage } from './pages/Settings'
import { ConnectionsPage } from './pages/Connections'
import { SECTION_META, TYPE_ORDER } from './lib/format'
import { LoginGate } from './pages/Login'
import { api } from './lib/api'

interface Status { configured: boolean; authenticated: boolean; canSetup: boolean; lockedOut: boolean }

function Root() {
  const [status, setStatus] = useState<Status | null>(null)

  const check = useCallback(async () => {
    try {
      setStatus(await api.get<Status>('/auth/status'))
    } catch {
      // If even the status call fails the server is unreachable; let the app
      // mount and show its own error rather than hanging on a blank screen.
      setStatus({ configured: false, authenticated: true, canSetup: true, lockedOut: false })
    }
  }, [])

  useEffect(() => { void check() }, [check])

  // A 401 from anywhere means the session lapsed: drop back to the login.
  useEffect(() => {
    const onUnauthorised = () => setStatus((s) => (s ? { ...s, authenticated: false } : s))
    window.addEventListener('mm-unauthenticated', onUnauthorised)
    return () => window.removeEventListener('mm-unauthenticated', onUnauthorised)
  }, [])

  if (!status) return <div className="loginwrap"><span className="spinner" /></div>
  if (!status.authenticated) return <LoginGate status={status} onIn={check} />

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            {TYPE_ORDER.map((type) => (
              <Route key={type} path={SECTION_META[type].path} element={<SectionPage type={type} />} />
            ))}
            <Route path="/work/:id" element={<WorkPage />} />
            <Route path="/diary" element={<DiaryPage />} />
            <Route path="/recommended" element={<RecommendedPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
        <LogDialog />
        <Palette />
      </AppProvider>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
