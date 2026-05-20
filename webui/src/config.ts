export const WS_ENDPOINT: string = import.meta.env.VITE_WS_ENDPOINT ?? ''

export const CALLSIGN_REGEX = /^[a-zA-Z0-9_]{3,20}$/

export const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000]
