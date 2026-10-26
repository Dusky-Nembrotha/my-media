import { StrictMode } from 'react'
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
import { ListsPage, ListDetailPage } from './pages/Lists'
import { StatsPage } from './pages/Stats'
import { ImportPage } from './pages/Import'
import { SettingsPage } from './pages/Settings'
import { ConnectionsPage } from './pages/Connections'
import { SECTION_META, TYPE_ORDER } from './lib/format'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
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
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:slug" element={<ListDetailPage />} />
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
  </StrictMode>,
)
