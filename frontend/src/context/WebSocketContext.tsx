import { createContext, useContext, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
const MIN_RECONNECT_DELAY = 1_000
const MAX_RECONNECT_DELAY = 30_000

type Handler = (data: Record<string, unknown>) => void

interface WebSocketContextValue {
  subscribe: (type: string, handler: Handler) => void
  unsubscribe: (type: string, handler: Handler) => void
  send: (msg: Record<string, unknown>) => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map())
  const reconnectDelay = useRef(MIN_RECONNECT_DELAY)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const pendingQueue = useRef<string[]>([])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const token = localStorage.getItem('token')
    if (!token) {
      // No token yet (user not logged in) — poll until one appears.
      reconnectTimer.current = setTimeout(connect, 1_000)
      return
    }

    const ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectDelay.current = MIN_RECONNECT_DELAY
      // Drain any messages that were queued while the socket was reconnecting.
      const queued = pendingQueue.current.splice(0)
      for (const raw of queued) ws.send(raw)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>
        const type = data.type as string
        if (!type) return
        const handlers = handlersRef.current.get(type)
        if (handlers) handlers.forEach(h => h(data))
      } catch {
        // ignore malformed frames
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!mountedRef.current) return
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY)
        connect()
      }, reconnectDelay.current)
    }

    ws.onerror = () => { ws.close() }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const subscribe = useCallback((type: string, handler: Handler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set())
    }
    handlersRef.current.get(type)!.add(handler)
  }, [])

  const unsubscribe = useCallback((type: string, handler: Handler) => {
    handlersRef.current.get(type)?.delete(handler)
  }, [])

  const send = useCallback((msg: Record<string, unknown>) => {
    const raw = JSON.stringify(msg)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(raw)
    } else {
      // Socket not ready yet — queue so signaling messages (call_accept, etc.)
      // are not silently dropped during reconnect.
      pendingQueue.current.push(raw)
    }
  }, [])

  return (
    <WebSocketContext.Provider value={{ subscribe, unsubscribe, send }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWebSocketContext must be used inside WebSocketProvider')
  return ctx
}

// useWebSocketEvent subscribes to a specific WS message type.
// The handler is kept stable via ref — no memoization required by the caller.
export function useWebSocketEvent(type: string, handler: Handler) {
  const { subscribe, unsubscribe } = useWebSocketContext()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const stable: Handler = (data) => handlerRef.current(data)
    subscribe(type, stable)
    return () => unsubscribe(type, stable)
  }, [type, subscribe, unsubscribe])
}
