// Thin shim — keeps the existing ChatApp call signature unchanged while
// delegating to the shared WebSocketContext connection.
import type { Message } from '../types'
import { useWebSocketEvent } from '../context/WebSocketContext'

interface UseWebSocketOptions {
  onMessage: (msg: Message) => void
  enabled: boolean
}

export function useWebSocket({ onMessage, enabled }: UseWebSocketOptions) {
  useWebSocketEvent('message', (data) => {
    if (!enabled) return
    onMessage(data as unknown as Message)
  })
}
