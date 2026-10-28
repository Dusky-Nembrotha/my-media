import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
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
import { InboxPage } from './pages/Inbox'
import { StatsPage } from './pages/Stats'
import { ImportPage } from './pages/Import'
import { SettingsPage } from './pages/Settings'
import { ConnectionsPage } from './pages/Connections'
import { SECTION_META, TYPE_ORDER } from './lib/format'
import { ScrollManager } from './components/ScrollManager'
import { FindPage } from './pages/Find'
import { LoginGate } from './pages/Login'
import { Empty } from './components/Modal'
import { api } from './lib/api'

interface Status { configured: boolean; authenticated: boolean; canSetup: boolean; lockedOut: boolean }

/*
 * An address that matches nothing.
 *
 * This used to redirect to Home without a word, which made every stale link
 * look like the app losing your place for no reason. Saying so is both more
 * honest and far easier to report.
 */
function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="page">
      <Empty icon="search" title="There is nothing at that address" action={<Link className="btn btn--primary" to="/">Go to Home</Link>}>
        <code style={{ fontSize: 12.5 }}>{pathname}</code> does not match any page.
      </Empty>
    </div>
  )
}

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
        <ScrollManager />
        <Shell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            {TYPE_ORDER.map((type) => (
              <Route key={type} path={SECTION_META[type].path} element={<SectionPage type={type} />} />
            ))}
            <Route path="/find" element={<FindPage />} />
            {/* Audiobooks folded into books; old links and bookmarks still work. */}
            <Route path="/work/:id" element={<WorkPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
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

/*
 * Register the service worker, which is what makes the app installable.
 *
 * Only in a built app: under the dev server there is no worker to fetch, and
 * a registration that 404s is noise. Failure is not worth reporting — the app
 * works exactly the same without it, it simply cannot be added to a home
 * screen.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
