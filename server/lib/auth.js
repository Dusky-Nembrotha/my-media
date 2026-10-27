import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { get, run } from './db.js'

/*
 * Single-password authentication.
 *
 * The password is stored as a scrypt hash, never in the clear. Sessions are
 * stateless signed cookies, so restarting the server does not log you out,
 * and changing the password invalidates every existing session at once.
 */

const SESSION_COOKIE = 'mm_session'
/*
 * Scope the cookie to wherever the app is mounted. On a shared hostname — a
 * reverse proxy, or a Tailscale Funnel port hosting several services — a
 * cookie at Path=/ would be sent to all the neighbours as well.
 */
const COOKIE_PATH = (process.env.SHELVED_BASE_PATH || process.env.MYMEDIA_BASE_PATH || '').replace(/\/$/, '') || '/'
const SESSION_DAYS = 60
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

function setting(key) {
  return get('SELECT value FROM settings WHERE key = ?', key)?.value || null
}

function putSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  )
}

function sessionSecret() {
  let secret = setting('auth_session_secret')
  if (!secret) {
    secret = randomBytes(32).toString('hex')
    putSetting('auth_session_secret', secret)
  }
  return secret
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

export function isConfigured() {
  return Boolean(setting('auth_password_hash'))
}

export function setPassword(password) {
  if (!password || String(password).length < 8) {
    throw new Error('Choose a password of at least 8 characters')
  }
  const { salt, hash } = hashPassword(password)
  putSetting('auth_password_salt', salt)
  putSetting('auth_password_hash', hash)
  // Rotating the secret signs every existing session out.
  putSetting('auth_session_secret', randomBytes(32).toString('hex'))
  return true
}

export function verifyPassword(password) {
  const salt = setting('auth_password_salt')
  const expected = setting('auth_password_hash')
  if (!salt || !expected) return false
  const { hash } = hashPassword(String(password ?? ''), salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** An environment password (Fly secret) wins, so a fresh deploy is never open. */
export function applyEnvPassword() {
  const fromEnv = process.env.SHELVED_PASSWORD || process.env.MYMEDIA_PASSWORD
  if (!fromEnv) return false
  const salt = setting('auth_password_salt')
  if (salt) {
    const { hash } = hashPassword(fromEnv, salt)
    if (hash === setting('auth_password_hash')) return false   // already current
  }
  setPassword(fromEnv)
  return true
}

/* ------------------------------------------------------------------ cookies */

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function unsign(token) {
  const [body, mac] = String(token || '').split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()) } catch { return null }
}

export function issueSession(res, req) {
  const token = sign({ iat: Date.now() })
  const secure = req.secure || req.get('x-forwarded-proto') === 'https'
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 3600}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; '))
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function hasValidSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  const payload = unsign(token)
  if (!payload?.iat) return false
  return Date.now() - payload.iat < SESSION_DAYS * 24 * 3600 * 1000
}

/* ------------------------------------------------- first-run and rate limits */

const attempts = new Map()

/*
 * A second limit that counts every failure regardless of who it came from.
 *
 * The per-address limit is the fair one — it stops one clumsy device locking
 * out the house. But behind a reverse proxy the client address comes from a
 * header the client itself can set, so anyone willing to vary it gets
 * unlimited guesses. This backstop cannot be spoofed because it does not look
 * at the address at all.
 *
 * It is set well above anything a person mistyping a password would reach, and
 * far below what a brute-force attempt needs.
 */
const GLOBAL_MAX = 25
let globalFirst = 0
let globalCount = 0

function globallyLocked() {
  if (!globalCount) return false
  if (Date.now() - globalFirst > ATTEMPT_WINDOW_MS) { globalCount = 0; return false }
  return globalCount >= GLOBAL_MAX
}

export function tooManyAttempts(ip) {
  if (globallyLocked()) return true
  const entry = attempts.get(ip)
  if (!entry) return false
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) { attempts.delete(ip); return false }
  return entry.count >= MAX_ATTEMPTS
}

export function noteFailure(ip) {
  const entry = attempts.get(ip)
  if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { first: Date.now(), count: 1 })
  } else {
    entry.count++
  }

  if (!globalCount || Date.now() - globalFirst > ATTEMPT_WINDOW_MS) {
    globalFirst = Date.now()
    globalCount = 1
  } else {
    globalCount++
  }
}

export function clearAttempts(ip) {
  attempts.delete(ip)
  // A correct password is good evidence that this is not an attack.
  globalCount = 0
}

/** Loopback and RFC1918 addresses only — used to gate first-run setup. */
export function isPrivateAddress(ip) {
  const addr = String(ip || '').replace(/^::ffff:/, '')
  if (addr === '::1' || addr === '127.0.0.1' || addr.startsWith('127.')) return true
  if (addr.startsWith('10.') || addr.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return true
  if (addr.startsWith('fd') || addr.startsWith('fc')) return true
  if (addr.startsWith('100.')) return true          // tailscale CGNAT range
  return false
}

/**
 * Setting the first password over the open internet would be a land grab, so
 * it is only allowed from a private network — or not at all once a deployment
 * has been given SHELVED_PASSWORD.
 */
export function canRunSetup(req) {
  if (isConfigured()) return false
  if (process.env.SHELVED_ALLOW_SETUP === '1' || process.env.MYMEDIA_ALLOW_SETUP === '1') return true
  return isPrivateAddress(req.ip || req.socket?.remoteAddress)
}

const OPEN_PATHS = new Set([
  '/auth/status', '/auth/login', '/auth/setup', '/auth/logout', '/health',
])

export function requireAuth(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next()
  // An unconfigured app on a private network stays usable, as it is today.
  if (!isConfigured() && isPrivateAddress(req.ip || req.socket?.remoteAddress)) return next()
  if (hasValidSession(req)) return next()
  res.status(401).json({ error: 'Not signed in', unauthenticated: true })
}
