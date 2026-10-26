import { Router } from 'express'
import {
  isConfigured, setPassword, verifyPassword, issueSession, clearSession,
  hasValidSession, canRunSetup, tooManyAttempts, noteFailure, clearAttempts,
  isPrivateAddress,
} from '../lib/auth.js'

export const router = Router()

router.get('/health', (req, res) => res.json({ ok: true }))

router.get('/auth/status', (req, res) => {
  const configured = isConfigured()
  res.json({
    configured,
    authenticated: configured ? hasValidSession(req) : isPrivateAddress(req.ip || req.socket?.remoteAddress),
    canSetup: canRunSetup(req),
    // Without a password an open deployment would be anyone's for the taking.
    lockedOut: !configured && !canRunSetup(req),
  })
})

router.post('/auth/setup', (req, res) => {
  if (isConfigured()) return res.status(409).json({ error: 'A password is already set' })
  if (!canRunSetup(req)) {
    return res.status(403).json({
      error: 'For safety the first password can only be set from your own network. '
        + 'On a hosted deployment, set the SHELVED_PASSWORD secret instead.',
    })
  }
  try {
    setPassword(req.body?.password)
    issueSession(res, req)
    res.json({ ok: true, configured: true, authenticated: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/auth/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Too many attempts — wait a quarter of an hour and try again' })
  }
  if (!isConfigured()) return res.status(409).json({ error: 'No password has been set yet' })
  if (!verifyPassword(req.body?.password)) {
    noteFailure(ip)
    return res.status(401).json({ error: 'That password is not right' })
  }
  clearAttempts(ip)
  issueSession(res, req)
  res.json({ ok: true, authenticated: true })
})

router.post('/auth/logout', (req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

/** Changing the password signs out every other device. */
router.post('/auth/password', (req, res) => {
  if (isConfigured() && !verifyPassword(req.body?.current)) {
    return res.status(401).json({ error: 'Your current password is not right' })
  }
  try {
    setPassword(req.body?.password)
    issueSession(res, req)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
