import { FormEvent, useEffect, useRef, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { ServerMessage } from '../types'

interface Props {
  callsign: string
  onLeave: () => void
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '--:--:--'
  }
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

function padCount(n: number): string {
  return n < 100 ? String(n).padStart(2, '0') : String(n)
}

interface MessageRowProps {
  msg: ServerMessage
  myCallsign: string
}

function MessageRow({ msg, myCallsign }: MessageRowProps) {
  const isOwn = msg.type === 'message' && msg.callsign === myCallsign
  const isSys  = msg.type === 'system'

  const displayCs = isSys ? 'system' : isOwn ? 'you' : msg.callsign
  const time      = formatTime(msg.timestamp)
  const text      = isSys
    ? `${msg.callsign} ${msg.event === 'user_joined' ? 'joined' : 'left'} the channel`
    : msg.text

  const rowCls = [
    'msg-row',
    isOwn ? 'msg-row--own' : '',
    isSys ? 'msg-row--sys' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={rowCls}>
      <span className="msg-cell--time">{time}</span>
      <span className="msg-vdiv msg-vdiv--1" aria-hidden="true" />
      <span className="msg-cell--cs">{displayCs}</span>
      <span className="msg-vdiv msg-vdiv--2" aria-hidden="true" />
      <span className="msg-cell--text">{text}</span>
    </div>
  )
}

export default function ChatScreen({ callsign, onLeave }: Props) {
  const { status, messages, onlineCount, messageCount, uptimeSeconds, sendMessage, reconnect } =
    useWebSocket(callsign)

  const [inputText, setInputText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  /* Auto-scroll to bottom when new messages arrive */
  useEffect(() => {
    if (atBottomRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const handleSend = (e: FormEvent) => {
    e.preventDefault()
    const text = inputText.trim()
    if (!text || text.length > 1000 || status !== 'connected') return
    sendMessage(text)
    setInputText('')
  }

  const statusLabel =
    status === 'connected'    ? 'CONNECTED'    :
    status === 'connecting'   ? 'CONNECTING…'  :
    status === 'reconnecting' ? 'RECONNECTING' : 'DISCONNECTED'

  const canSend = status === 'connected' && inputText.trim().length > 0

  return (
    <div className="chat">
      {/* Accessible live region for status changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusLabel}
      </div>

      {/* ── Top bar ── */}
      <header className="chat__topbar">
        <span className="chat__topbar-logo">ANON CHAT</span>
        <div className="chat__topbar-spacer" />
        <div className="chat__status" role="status" aria-label={`Connection status: ${statusLabel}`}>
          <span className={`chat__status-dot chat__status-dot--${status}`} />
          <span className="chat__status-label">{statusLabel}</span>
        </div>
      </header>

      {/* ── Mobile stats bar ── */}
      <div className="chat__statsbar" aria-hidden="true">
        <div className="chat__statsbar-item">
          <span className="chat__statsbar-label">ONLINE</span>
          <span className="chat__statsbar-value">{padCount(onlineCount)}</span>
        </div>
        <div className="chat__statsbar-item" style={{ justifyContent: 'flex-end' }}>
          <span className="chat__statsbar-label">MSGS</span>
          <span className="chat__statsbar-value">{messageCount}</span>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="chat__content">

        {/* Message panel */}
        <div className="chat__msgs">
          {/* Desktop grid header */}
          <div className="chat__grid-header" aria-hidden="true">
            <span className="chat__col-label chat__col-label--time">TIME</span>
            <span className="chat__col-div" />
            <span className="chat__col-label chat__col-label--cs">CALLSIGN</span>
            <span className="chat__col-div" />
            <span className="chat__col-label chat__col-label--msg">MESSAGE</span>
          </div>

          {/* Disconnected banner */}
          {status === 'disconnected' && (
            <div className="chat__disconnected-banner" role="alert">
              <span className="chat__disconnected-text">CONNECTION LOST</span>
              <button className="chat__reconnect-btn" onClick={reconnect}>
                RECONNECT
              </button>
              <button
                className="chat__reconnect-btn"
                onClick={onLeave}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.25)' }}
              >
                LEAVE
              </button>
            </div>
          )}

          {/* Message list */}
          <div
            className="chat__msg-list"
            ref={listRef}
            onScroll={handleScroll}
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.length === 0 && status === 'connected' && (
              <p className="chat__msg-empty">NO MESSAGES YET — SAY SOMETHING</p>
            )}
            {messages.map((msg, i) => (
              <MessageRow key={i} msg={msg} myCallsign={callsign} />
            ))}
          </div>
        </div>

        {/* ── Right sidebar (desktop only) ── */}
        <aside className="chat__sidebar" aria-label="Live stats">
          <div className="chat__sidebar-header">
            <span className="chat__sidebar-header-label">LIVE STATS</span>
          </div>

          <div className="chat__stat-block">
            <span className="chat__stat-label">USERS ONLINE</span>
            <span className="chat__stat-value chat__stat-value--lg">{padCount(onlineCount)}</span>
          </div>

          <div className="chat__stat-block">
            <span className="chat__stat-label">MESSAGES TODAY</span>
            <span className="chat__stat-value chat__stat-value--lg">{messageCount}</span>
          </div>

          <div className="chat__stat-block">
            <span className="chat__stat-label">SESSION UPTIME</span>
            <span className="chat__stat-value chat__stat-value--md">{formatUptime(uptimeSeconds)}</span>
          </div>

          <div className="chat__sidebar-spacer" />

          <div className="chat__sidebar-callsign">
            <span className="chat__stat-label">YOUR CALLSIGN</span>
            <span className="chat__your-callsign">{callsign}</span>
          </div>
        </aside>
      </div>

      {/* ── Input bar ── */}
      <form className="chat__inputbar" onSubmit={handleSend} noValidate>
        <div className="chat__input-wrap">
          <input
            className="chat__input"
            type="text"
            placeholder="Type a message…"
            maxLength={1000}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            disabled={status !== 'connected'}
            aria-label="Message input"
          />
        </div>
        <button
          type="submit"
          className="chat__send-btn"
          disabled={!canSend}
          aria-label="Send message"
        >
          SEND
        </button>
      </form>
    </div>
  )
}
