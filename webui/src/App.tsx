import { useState } from 'react'
import JoinScreen from './components/JoinScreen'
import ChatScreen from './components/ChatScreen'

type Screen = 'join' | 'chat'

export default function App() {
  const [screen, setScreen] = useState<Screen>('join')
  const [callsign, setCallsign] = useState('')

  const handleJoin = (cs: string) => {
    setCallsign(cs)
    setScreen('chat')
  }

  const handleLeave = () => {
    setCallsign('')
    setScreen('join')
  }

  return screen === 'join'
    ? <JoinScreen onJoin={handleJoin} />
    : <ChatScreen callsign={callsign} onLeave={handleLeave} />
}
