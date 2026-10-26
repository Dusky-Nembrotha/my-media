import { all, get, run, json } from '../lib/db.js'

/** Everything persisted about one connected service. */
export function loadConnection(id) {
  const row = get('SELECT * FROM connections WHERE id = ?', id)
  if (!row) {
    return { id, status: 'disconnected', config: {}, tokens: {}, pending: {}, account: null, last_sync_at: null, last_result: {}, message: null }
  }
  return {
    ...row,
    config: json(row.config, {}),
    tokens: json(row.tokens, {}),
    pending: json(row.pending, {}),
    last_result: json(row.last_result, {}),
  }
}

export function listConnections() {
  return all('SELECT * FROM connections').map((r) => ({
    ...r,
    config: json(r.config, {}),
    tokens: json(r.tokens, {}),
    pending: json(r.pending, {}),
    last_result: json(r.last_result, {}),
  }))
}

export function saveConnection(id, patch) {
  const current = loadConnection(id)
  const next = { ...current, ...patch }
  run(
    `INSERT INTO connections (id, status, config, tokens, account, pending, last_sync_at, last_result, message)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, config = excluded.config, tokens = excluded.tokens,
       account = excluded.account, pending = excluded.pending, last_sync_at = excluded.last_sync_at,
       last_result = excluded.last_result, message = excluded.message, updated_at = datetime('now')`,
    id,
    next.status || 'disconnected',
    JSON.stringify(next.config || {}),
    JSON.stringify(next.tokens || {}),
    next.account ?? null,
    JSON.stringify(next.pending || {}),
    next.last_sync_at ?? null,
    JSON.stringify(next.last_result || {}),
    next.message ?? null,
  )
  return loadConnection(id)
}

export function forgetConnection(id) {
  run('DELETE FROM connections WHERE id = ?', id)
}

/** Never let a secret reach the browser; say only whether one is stored. */
export function redactConfig(config, fields) {
  const out = {}
  for (const f of fields) {
    const value = config?.[f.key]
    out[f.key] = f.secret && value ? '••••••••' + String(value).slice(-4) : (value ?? '')
  }
  return out
}
