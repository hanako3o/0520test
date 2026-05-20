import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectionStatus, ServerMessage } from '../types'
import { RECONNECT_DELAYS, WS_ENDPOINT } from '../config'

interface UseWebSocketReturn {
  status: ConnectionStatus
  messages: ServerMessage[]
  onlineCount: number
  messageCount: number
  uptimeSeconds: number
  sendMessage: (text: string) => void
  reconnect: () => void
}

export function useWebSocket(callsign: string): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [messages, setMessages] = useState<ServerMessage[]>([])
  const [onlineCount, setOnlineCount] = useState(1)
  const [messageCount, setMessageCount] = useState(0)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectedAtRef = useRef<number>(0)
  const unmountedRef = useRef(false)
  const manualCloseRef = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  const stopUptime = () => {
    if (uptimeTimerRef.current) {
      clearInterval(uptimeTimerRef.current)
      uptimeTimerRef.current = null
    }
  }

  const stopRetry = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  const connect = useCallback(() => {
    if (unmountedRef.current) return
    if (!WS_ENDPOINT) {
      setStatus('disconnected')
      return
    }

    manualCloseRef.current = false
    const url = `${WS_ENDPOINT}?callsign=${encodeURIComponent(callsign)}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      setStatus('disconnected')
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return }
      retryCountRef.current = 0
      connectedAtRef.current = Date.now()
      setStatus('connected')
      uptimeTimerRef.current = setInterval(() => {
        if (!unmountedRef.current) {
          setUptimeSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000))
        }
      }, 1000)
    }

    ws.onmessage = (event: MessageEvent) => {
      if (unmountedRef.current) return
      try {
        const data = JSON.parse(event.data as string) as ServerMessage
        setMessages(prev => [...prev, data])
        if (data.type === 'message') {
          setMessageCount(prev => prev + 1)
        } else {
          setOnlineCount(prev =>
            data.event === 'user_joined' ? prev + 1 : Math.max(1, prev - 1)
          )
        }
      } catch {
        // ignore malformed frames
      }
    }

    ws.onclose = () => {
      if (unmountedRef.current) return
      stopUptime()

      if (manualCloseRef.current) {
        setStatus('disconnected')
        return
      }

      const delay = RECONNECT_DELAYS[retryCountRef.current]
      if (delay === undefined) {
        setStatus('disconnected')
        return
      }

      setStatus('reconnecting')
      retryCountRef.current += 1
      retryTimerRef.current = setTimeout(() => connectRef.current(), delay)
    }

    ws.onerror = () => {
      // onclose fires after onerror; handle everything there
    }
  }, [callsign])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    unmountedRef.current = false
    connect()
    return () => {
      unmountedRef.current = true
      manualCloseRef.current = true
      stopRetry()
      stopUptime()
      wsRef.current?.close()
    }
  }, [connect])

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'sendMessage', text }))
    }
  }, [])

  const reconnect = useCallback(() => {
    stopRetry()
    retryCountRef.current = 0
    wsRef.current?.close()
    connect()
  }, [connect])

  return { status, messages, onlineCount, messageCount, uptimeSeconds, sendMessage, reconnect }
}
