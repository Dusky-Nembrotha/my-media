import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { MediaType, SectionInfo, Work, ProviderHit } from './types'

type Toast = { id: number; message: string; tone: 'ok' | 'error' | 'info' }

export type LogTarget =
  | { kind: 'work'; work: Work }
  | { kind: 'hit'; hit: ProviderHit }
  | { kind: 'blank'; type?: MediaType; mode?: 'log' | 'want' }

interface Ctx {
  sections: SectionInfo[]
  counts: { works: number; entries: number; recsOpen: number; lists: number }
  settings: Record<string, any>
  refresh: () => Promise<void>
  toast: (message: string, tone?: Toast['tone']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  logTarget: LogTarget | null
  openLog: (target: LogTarget) => void
  closeLog: () => void
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  version: number
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [counts, setCounts] = useState({ works: 0, entries: 0, recsOpen: 0, lists: 0 })
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [theme, setThemeState] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('mm-theme') as 'dark' | 'light') || 'dark',
  )

  const setTheme = useCallback((t: 'dark' | 'light') => {
    setThemeState(t)
    localStorage.setItem('mm-theme', t)
    document.documentElement.dataset.theme = t
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  const refresh = useCallback(async () => {
    try {
      const [boot, secs] = await Promise.all([
        api.get<{ counts: Ctx['counts']; settings: Record<string, any> }>('/bootstrap'),
        api.get<SectionInfo[]>('/sections'),
      ])
      setCounts(boot.counts)
      setSettings(boot.settings)
      setSections(secs)
      setVersion((v) => v + 1)
    } catch (err) {
      // The app still works offline-ish; the toast tells the user why it is bare.
      console.error(err)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toast = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const value = useMemo<Ctx>(() => ({
    sections,
    counts,
    settings,
    refresh,
    toast,
    toasts,
    dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
    logTarget,
    openLog: setLogTarget,
    closeLog: () => setLogTarget(null),
    paletteOpen,
    setPaletteOpen,
    theme,
    setTheme,
    version,
  }), [sections, counts, settings, refresh, toast, toasts, logTarget, paletteOpen, theme, setTheme, version])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

/** Tiny data-fetching hook: enough for a single-user app, no library needed. */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) { setLoading(false); return }
    let live = true
    setLoading(true)
    setError(null)
    api.get<T>(path)
      .then((d) => { if (live) { setData(d); setLoading(false) } })
      .catch((e) => { if (live) { setError(e.message); setLoading(false) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, loading, error, reload: () => setNonce((n) => n + 1), setData }
}
