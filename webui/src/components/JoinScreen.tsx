import { FormEvent, useState } from 'react'
import { CALLSIGN_REGEX, WS_ENDPOINT } from '../config'

interface Props {
  onJoin: (callsign: string) => void
}

export default function JoinScreen({ onJoin }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const validate = (v: string): string => {
    if (!v.trim()) return 'Callsign is required.'
    if (!CALLSIGN_REGEX.test(v)) return 'Must be 3–20 characters, letters / numbers / underscores only.'
    return ''
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const err = validate(value)
    if (err) { setError(err); return }
    onJoin(value.trim())
  }

  return (
    <div className="join">
      {/* Dark hero panel */}
      <div className="join__hero" role="banner">
        <p className="join__logo">{'ANON\nCHAT'}</p>
        <p className="join__tagline">Speak freely.<br />Leave no trace.</p>
        <div className="join__hero-divider" />
        <p className="join__online-hint">USERS ONLINE: —</p>
      </div>

      {/* Form panel */}
      <div className="join__form-panel">
        <form className="join__form" onSubmit={handleSubmit} noValidate>
          <p className="join__section-label">JOIN THE ROOM</p>

          <label className="join__field-label" htmlFor="callsign-input">
            CALLSIGN
          </label>

          <div className="join__input-wrap">
            <input
              id="callsign-input"
              className="join__input"
              type="text"
              placeholder="enter your callsign"
              maxLength={20}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={value}
              onChange={e => { setValue(e.target.value); setError('') }}
              aria-describedby="callsign-hint callsign-error"
              aria-invalid={error ? 'true' : 'false'}
            />
          </div>

          <p id="callsign-hint" className="join__hint">
            3–20 characters · letters, numbers, underscores only
          </p>
          <p id="callsign-error" className="join__error" role="alert" aria-live="assertive">
            {error}
          </p>

          {!WS_ENDPOINT && (
            <p className="join__no-endpoint">
              No WebSocket endpoint configured. Set <code>VITE_WS_ENDPOINT</code> in{' '}
              <code>.env.local</code> before connecting to the backend.
            </p>
          )}

          <button type="submit" className="join__btn">
            JOIN
          </button>
        </form>
      </div>
    </div>
  )
}
