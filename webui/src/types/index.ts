export interface ChatMessage {
  type: 'message'
  callsign: string
  text: string
  timestamp: string
}

export interface SystemEvent {
  type: 'system'
  event: 'user_joined' | 'user_left'
  callsign: string
  timestamp: string
}

export type ServerMessage = ChatMessage | SystemEvent

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
