import { useState, useEffect, useRef } from 'react'
import { useWebSocketEvent } from '../context/WebSocketContext'

const CLEAR_AFTER_MS = 5_000
// Approximate chars that fit one line in max-w-sm at text-sm.
// When the active line exceeds this, it gets promoted and a new line starts.
const CHARS_PER_LINE = 48

/**
 * Classic two-line rolling subtitle.
 * Text accumulates on the active (bottom) line until it's full,
 * then the active line slides up and a new bottom line starts.
 * After CLEAR_AFTER_MS of silence both lines clear.
 */
export default function CaptionOverlay() {
  const [top, setTop]       = useState('')
  const [bottom, setBottom] = useState('')
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useWebSocketEvent('caption', (data) => {
    const chunk = (data.translation as string) || (data.transcript as string)
    if (!chunk?.trim()) return

    setBottom(prev => {
      const next = prev ? `${prev} ${chunk.trim()}` : chunk.trim()
      if (next.length > CHARS_PER_LINE) {
        // Active line is full — slide it up and start a fresh bottom line.
        setTop(prev || '')
        return chunk.trim()
      }
      return next
    })

    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => { setTop(''); setBottom('') }, CLEAR_AFTER_MS)
  })

  useEffect(() => {
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current) }
  }, [])

  if (!top && !bottom) return null

  return (
    <div className="absolute bottom-4 left-0 right-0 flex justify-center px-6 pointer-events-none z-10">
      <div className="bg-black/75 text-white text-sm px-4 py-2 rounded-lg max-w-sm text-center leading-snug">
        {top    && <div className="text-gray-400">{top}</div>}
        {bottom && <div className="text-white">{bottom}</div>}
      </div>
    </div>
  )
}
