import { useEffect, useState } from 'react'
import { useWebSocketContext, useWebSocketEvent } from '../context/WebSocketContext'

export interface IncomingCall {
  callId: string
  fromId: string
  fromName: string
}

interface Props {
  onAccept: (call: IncomingCall) => void
  onDecline: (call: IncomingCall) => void
}

export default function IncomingCallModal({ onAccept, onDecline }: Props) {
  const { send } = useWebSocketContext()
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)

  useWebSocketEvent('call_incoming', (data) => {
    setIncoming({
      callId:   data.call_id   as string,
      fromId:   data.from_id   as string,
      fromName: data.from_name as string,
    })
  })

  // Auto-dismiss after 45 s — notify the caller so they don't wait forever.
  useEffect(() => {
    if (!incoming) return
    const t = setTimeout(() => {
      send({ type: 'call_reject', to: incoming.fromId, call_id: incoming.callId })
      setIncoming(null)
    }, 45_000)
    return () => clearTimeout(t)
  }, [incoming, send])

  if (!incoming) return null

  const handleDecline = () => {
    send({ type: 'call_reject', to: incoming.fromId, call_id: incoming.callId })
    onDecline(incoming)
    setIncoming(null)
  }

  const handleAccept = () => {
    onAccept(incoming)
    setIncoming(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm flex flex-col items-center gap-5 shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-indigo-700 flex items-center justify-center text-2xl font-bold select-none">
          {incoming.fromName[0].toUpperCase()}
        </div>
        <div className="text-center">
          <p className="text-white font-semibold text-lg">{incoming.fromName}</p>
          <p className="text-gray-400 text-sm mt-1">Incoming video call…</p>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={handleDecline}
            className="flex-1 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white rounded-xl py-4 font-medium transition-colors text-base"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white rounded-xl py-4 font-medium transition-colors text-base"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
