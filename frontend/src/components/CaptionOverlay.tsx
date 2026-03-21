import { useState, useEffect, useRef } from 'react'
import { useWebSocketEvent } from '../context/WebSocketContext'

const CLEAR_AFTER_MS = 12_000
const MAX_HISTORY = 2

/**
 * Rolling subtitle display.
 *
 * caption_partial → live text updates in-place (white, active)
 * caption_final   → text "settles" but stays visible (slightly dim)
 *                   Only moves to history when the NEXT utterance starts.
 *
 * This prevents any visible gap between sentences.
 */
export default function CaptionOverlay() {
  const [history, setHistory]     = useState<string[]>([])
  const [live, setLive]           = useState('')
  const [settled, setSettled]     = useState(false)
  const liveRef                   = useRef('')
  const settledRef                = useRef(false)
  const clearTimer                = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetClearTimer = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => {
      setHistory([])
      setLive('')
      setSettled(false)
      liveRef.current = ''
      settledRef.current = false
    }, CLEAR_AFTER_MS)
  }

  useWebSocketEvent('caption_partial', (data) => {
    const text = (data.translation as string) || (data.transcript as string)
    if (!text?.trim()) return

    const trimmed = text.trim()

    // If we're settled and the new partial shares >80% of words with the
    // current settled text, it's a trailing refinement of the same sentence —
    // not a new utterance. Ignore it to prevent visual repetition.
    if (settledRef.current && liveRef.current && wordOverlap(liveRef.current, trimmed) > 0.8) {
      resetClearTimer()
      return
    }

    // New utterance starting — commit the previous settled line to history.
    if (settledRef.current && liveRef.current) {
      setHistory(prev => [...prev, liveRef.current].slice(-MAX_HISTORY))
    }

    liveRef.current = trimmed
    settledRef.current = false
    setLive(trimmed)
    setSettled(false)
    resetClearTimer()
  })

  useWebSocketEvent('caption_final', (data) => {
    const text = (data.translation as string) || (data.transcript as string)
    if (!text?.trim()) return

    liveRef.current = text.trim()
    settledRef.current = true
    setLive(text.trim())
    setSettled(true)
    resetClearTimer()
  })

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current) }, [])

  if (!live && history.length === 0) return null

  return (
    <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4 pointer-events-none z-10">
      <div className="bg-black/75 text-white text-sm px-3 py-2 rounded-lg max-w-[90%] md:max-w-lg text-center leading-snug space-y-0.5 inline-block">
        {history.map((line, i) => (
          <div key={i} className="text-gray-400 text-xs">{line}</div>
        ))}
        {live && (
          <div className={settled ? 'text-gray-300' : 'text-white font-medium'}>
            {live}
          </div>
        )}
      </div>
    </div>
  )
}

/** Fraction of words in common between two strings (0–1). */
function wordOverlap(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean)
  if (aWords.size === 0 || bWords.length === 0) return 0
  const common = bWords.filter(w => aWords.has(w)).length
  return common / Math.max(aWords.size, bWords.length)
}
