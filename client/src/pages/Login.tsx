import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { api } from '../lib/api'

interface Status {
  configured: boolean
  authenticated: boolean
  canSetup: boolean
  lockedOut: boolean
}

/**
 * Sits in front of everything until you are signed in. Doubles as the
 * first-run screen where the password is chosen.
 */
export function LoginGate({ status, onIn }: { status: Status; onIn: () => void }) {
  const setup = !status.configured
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setError(null) }, [password, confirm])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (setup && password !== confirm) { setError('Those two do not match'); return }
    setBusy(true)
    try {
      await api.post(setup ? '/auth/setup' : '/auth/login', { password })
      onIn()
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  if (status.lockedOut) {
    return (
      <div className="loginwrap">
        <div className="logincard">
          <span className="rail__mark" style={{ width: 44, height: 44, fontSize: 24 }}>M</span>
          <h1>Not set up yet</h1>
          <p className="u-sm u-mut">
            This copy of My Media has no password, and for safety the first one cannot be chosen
            over the public internet — otherwise whoever found the address first would own it.
          </p>
          <p className="u-sm u-mut">
            Set the <code>MYMEDIA_PASSWORD</code> secret on the deployment and restart, or open the
            app from the machine it runs on.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="loginwrap">
      <form className="logincard" onSubmit={submit}>
        <span className="rail__mark" style={{ width: 44, height: 44, fontSize: 24 }}>M</span>
        <h1>{setup ? 'Choose a password' : 'My Media'}</h1>
        <p className="u-sm u-mut" style={{ margin: 0 }}>
          {setup
            ? 'This is the only thing standing between your library and anyone who finds the address. Make it a good one.'
            : 'Sign in to your library.'}
        </p>

        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            className="input"
            type="password"
            autoFocus
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {setup && <span className="field__hint">At least 8 characters.</span>}
        </div>

        {setup && (
          <div className="field">
            <label htmlFor="pw2">And again</label>
            <input
              id="pw2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}

        {error && <p className="loginerror">{error}</p>}

        <button className="btn btn--primary btn--lg btn--block" disabled={busy || password.length < 1}>
          {busy ? 'One moment…' : setup ? 'Set password and continue' : 'Sign in'}
          <Icon name="chevronRight" size={15} />
        </button>
      </form>
    </div>
  )
}
