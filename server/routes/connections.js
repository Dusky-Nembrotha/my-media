import { Router } from 'express'
import { catalogue, getConnector } from '../connections/index.js'
import { loadConnection, saveConnection, forgetConnection, redactConfig } from '../connections/store.js'
import { applyRecords } from '../importers/apply.js'
import { all, get, run } from '../lib/db.js'
import { getSettings } from '../lib/settings.js'
import { currentUserId } from '../lib/user.js'

export const router = Router()

/** Public view of a connection: never includes a secret. */
function publicState(connector, conn) {
  return {
    id: connector.id,
    status: conn.status,
    account: conn.account,
    config: redactConfig(conn.config, connector.fields || []),
    configured: (connector.fields || []).every((f) => !f.required_for_connect || conn.config?.[f.key]),
    hasCredentials: (connector.fields || []).filter((f) => f.secret).every((f) => Boolean(conn.config?.[f.key]))
      && (connector.fields || []).every((f) => Boolean(conn.config?.[f.key]) || f.key === 'redirect_uri'),
    pending: conn.pending?.mode ? { ...conn.pending, device_code: undefined } : null,
    last_sync_at: conn.last_sync_at,
    last_result: conn.last_result,
    message: conn.message,
  }
}

/**
 * What each service has actually put in the library. A file import is just as
 * real as a live connection, so the card should say so.
 */
function importHistory() {
  const bySource = new Map()
  for (const row of all('SELECT source, count(*) c, max(created_at) last FROM entries GROUP BY source')) {
    bySource.set(row.source, { entries: row.c, lastEntry: row.last, recs: 0, runs: 0, lastImport: null, lastImportEntries: null })
  }
  for (const row of all(
    `SELECT source, count(*) runs, max(started_at) last_at,
            sum(entries_added) added, sum(recs_added) recs
       FROM import_runs WHERE status = 'done' GROUP BY source`,
  )) {
    const entry = bySource.get(row.source) || { entries: 0, lastEntry: null, recs: 0 }
    entry.runs = row.runs
    entry.lastImport = row.last_at
    entry.lastImportEntries = row.added
    entry.recs = row.recs || 0
    bySource.set(row.source, entry)
  }
  return bySource
}

router.get('/connections', (req, res) => {
  const cat = catalogue()
  const settings = getSettings()
  const history = importHistory()
  const withHistory = (s) => ({ ...s, history: history.get(s.id) || null })
  res.json({
    live: cat.live.map((c) => {
      const connector = getConnector(c.id)
      return { ...withHistory(c), state: publicState(connector, loadConnection(c.id)) }
    }),
    fileOnly: cat.fileOnly.map(withHistory),
    metadata: cat.metadata.map((m) => ({
      ...m,
      connected: m.settingKey ? Boolean(settings[m.settingKey]) : true,
    })),
  })
})

/** Save the ids and keys you pasted in. Blank or masked values are ignored. */
router.put('/connections/:id/config', (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector) return res.status(404).json({ error: 'Unknown service' })
  const conn = loadConnection(connector.id)
  const config = { ...conn.config }
  for (const field of connector.fields || []) {
    const value = req.body?.[field.key]
    if (value === undefined) continue
    if (value === '' || String(value).startsWith('••')) continue
    config[field.key] = String(value).trim()
  }
  const saved = saveConnection(connector.id, { config, message: null })
  res.json(publicState(connector, saved))
})

/** Start the handshake: a device code, or a URL to approve. */
router.post('/connections/:id/begin', async (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector) return res.status(404).json({ error: 'Unknown service' })
  const conn = loadConnection(connector.id)
  try {
    // Key-only services have nothing to approve: verify and finish here.
    if (connector.kind === 'api-key') {
      const result = await connector.connect({ config: conn.config })
      const saved = saveConnection(connector.id, {
        status: result.status,
        account: result.account ?? null,
        tokens: result.tokens || {},
        pending: {},
        message: null,
      })
      return res.json({ done: true, state: publicState(connector, saved) })
    }

    const pending = await connector.begin({ config: conn.config })
    const saved = saveConnection(connector.id, { status: 'pending', pending, message: null })
    res.json({
      done: false,
      pending: { ...pending, device_code: undefined },
      state: publicState(connector, saved),
    })
  } catch (err) {
    saveConnection(connector.id, { status: 'error', message: err.message })
    res.status(400).json({ error: err.message })
  }
})

/** Device flow: has it been approved yet? */
router.post('/connections/:id/poll', async (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector?.poll) return res.status(400).json({ error: 'That service does not use a device code' })
  const conn = loadConnection(connector.id)
  try {
    const result = await connector.poll({ config: conn.config, pending: conn.pending })
    if (result.status === 'pending') return res.json({ status: 'pending' })
    if (result.status === 'error') {
      const saved = saveConnection(connector.id, { status: 'error', pending: {}, message: result.message })
      return res.json({ status: 'error', message: result.message, state: publicState(connector, saved) })
    }
    let account = null
    try { account = await connector.account({ config: conn.config, tokens: result.tokens }) } catch { /* optional */ }
    const saved = saveConnection(connector.id, {
      status: 'connected', tokens: result.tokens, pending: {}, account, message: null,
    })
    res.json({ status: 'connected', state: publicState(connector, saved) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/** Redirect flow: finish with the code (or the whole pasted URL). */
router.post('/connections/:id/exchange', async (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector?.exchange) return res.status(400).json({ error: 'That service does not use a redirect' })
  const conn = loadConnection(connector.id)
  try {
    const result = await connector.exchange({ config: conn.config, code: req.body?.code })
    let account = null
    try { account = await connector.account({ config: conn.config, tokens: result.tokens }) } catch { /* optional */ }
    const saved = saveConnection(connector.id, {
      status: 'connected', tokens: result.tokens, pending: {}, account, message: null,
    })
    res.json({ status: 'connected', state: publicState(connector, saved) })
  } catch (err) {
    saveConnection(connector.id, { status: 'error', message: err.message })
    res.status(400).json({ error: err.message })
  }
})

/** Where the service sends the browser back to. */
router.get('/connections/:id/callback', async (req, res) => {
  const connector = getConnector(req.params.id)
  const code = req.query.code
  const error = req.query.error
  const page = (title, body) => `<!doctype html><meta charset="utf-8">
    <title>${title}</title>
    <body style="margin:0;font:15px/1.6 system-ui,sans-serif;background:#0a0812;color:#f3f1f9;display:grid;place-items:center;height:100vh">
    <div style="max-width:30rem;padding:2rem;text-align:center">
      <h1 style="font-size:1.3rem;margin:0 0 .6rem">${title}</h1>${body}
    </div></body>`

  if (error) return res.status(400).send(page('Not connected', `<p>${String(error)}</p><p>Close this and try again.</p>`))
  if (!connector?.exchange || !code) return res.status(400).send(page('Nothing to do', '<p>No authorisation code arrived.</p>'))

  const conn = loadConnection(connector.id)
  try {
    const result = await connector.exchange({ config: conn.config, code })
    let account = null
    try { account = await connector.account({ config: conn.config, tokens: result.tokens }) } catch { /* optional */ }
    saveConnection(connector.id, { status: 'connected', tokens: result.tokens, pending: {}, account, message: null })
    res.send(page(`${connector.label} connected`, `<p>Signed in as <strong>${account || 'your account'}</strong>.</p><p>You can close this tab and go back to My Media.</p>`))
  } catch (err) {
    saveConnection(connector.id, { status: 'error', message: err.message })
    res.status(400).send(page('Could not finish', `<p>${err.message}</p>`))
  }
})

/** Make sure we have a usable token, refreshing if it has expired. */
async function withFreshTokens(connector, conn) {
  const expires = conn.tokens?.expires_at ? new Date(conn.tokens.expires_at).getTime() : null
  if (!connector.refresh || !expires || expires - Date.now() > 120000) return conn.tokens
  const tokens = await connector.refresh({ config: conn.config, tokens: conn.tokens })
  saveConnection(connector.id, { tokens })
  return tokens
}

/** Pull everything down and run it through the normal import pipeline. */
router.post('/connections/:id/sync', async (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector) return res.status(404).json({ error: 'Unknown service' })
  const conn = loadConnection(connector.id)
  if (conn.status !== 'connected') return res.status(400).json({ error: `${connector.label} is not connected yet` })

  const runRow = run(
    "INSERT INTO import_runs (user_id, source, filename, status) VALUES (?, ?, 'live sync', 'running')",
    currentUserId(req), connector.id,
  )
  const runId = Number(runRow.lastInsertRowid)

  try {
    const tokens = await withFreshTokens(connector, conn)
    const options = { ...(req.body?.options || {}) }
    const records = await connector.sync({ config: conn.config, tokens, options })
    const summary = applyRecords(records, { source: connector.id, filename: 'live sync', enrich: true })

    run(
      `UPDATE import_runs SET status = 'done', works_added = ?, entries_added = ?, entries_skipped = ?,
         recs_added = ?, detail = ?, finished_at = datetime('now') WHERE id = ?`,
      summary.worksAdded, summary.entriesAdded, summary.entriesSkipped, summary.recsAdded,
      JSON.stringify(summary), runId,
    )
    const saved = saveConnection(connector.id, {
      last_sync_at: new Date().toISOString(),
      last_result: {
        entriesAdded: summary.entriesAdded,
        entriesUpdated: summary.entriesUpdated,
        worksAdded: summary.worksAdded,
        recsAdded: summary.recsAdded,
        skipped: summary.entriesSkipped,
        total: summary.total,
      },
      message: null,
    })
    res.json({ ok: true, summary, state: publicState(connector, saved) })
  } catch (err) {
    run("UPDATE import_runs SET status = 'failed', message = ?, finished_at = datetime('now') WHERE id = ?", err.message, runId)
    // A 401 means the stored token is no good any more.
    const status = err.status === 401 ? 'error' : conn.status
    saveConnection(connector.id, { status, message: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.post('/connections/:id/disconnect', async (req, res) => {
  const connector = getConnector(req.params.id)
  if (!connector) return res.status(404).json({ error: 'Unknown service' })
  const conn = loadConnection(connector.id)
  if (connector.revoke) {
    try { await connector.revoke({ config: conn.config, tokens: conn.tokens }) } catch { /* best effort */ }
  }
  // Keep the client id/secret so reconnecting does not mean pasting them again.
  const saved = req.body?.forget
    ? (forgetConnection(connector.id), loadConnection(connector.id))
    : saveConnection(connector.id, { status: 'disconnected', tokens: {}, pending: {}, account: null, message: null })
  res.json({ ok: true, state: publicState(connector, saved) })
})
