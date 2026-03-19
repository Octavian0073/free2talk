import { useEffect, useRef, useCallback } from 'react'

const WS_AUDIO_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/audio`

interface UseAudioCaptureOptions {
  peerId: string
  localStream: MediaStream | null
  enabled: boolean  // start capturing only when the call is active
}

/**
 * Streams 1.5-second WebM/Opus audio chunks to /ws/audio over a dedicated
 * binary WebSocket. The Go backend forwards each chunk to the ml-service for
 * STT + translation and delivers caption events to the peer via the main Hub.
 *
 * Each sent blob is a self-contained WebM file (init segment prepended) so
 * faster-whisper can decode it independently without container state.
 */
export function useAudioCapture({ peerId, localStream, enabled }: UseAudioCaptureOptions) {
  const wsRef       = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const initChunk   = useRef<Blob | null>(null)
  const chunkIdx    = useRef(0)

  const stopCapture = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    wsRef.current?.close()
    wsRef.current  = null
    initChunk.current = null
    chunkIdx.current  = 0
  }, [])

  useEffect(() => {
    console.log('[AudioCapture] effect run — enabled:', enabled, 'localStream:', localStream ? 'set' : 'null', 'peerId:', peerId)
    if (!enabled || !localStream || !peerId) return

    const token = localStorage.getItem('token')
    if (!token) return

    const tracks = localStream.getAudioTracks()
    console.log('[AudioCapture] audio tracks:', tracks.length, tracks.map(t => `${t.label}(${t.readyState})`))

    const ws = new WebSocket(
      `${WS_AUDIO_BASE}?token=${encodeURIComponent(token)}&to_id=${encodeURIComponent(peerId)}`
    )
    ws.binaryType = 'blob'
    wsRef.current = ws

    ws.onclose = (e) => {
      console.warn('[AudioCapture] WS closed — code:', e.code, 'reason:', e.reason, 'wasClean:', e.wasClean)
    }

    ws.onopen = () => {
      console.log('[AudioCapture] WS opened')
      const audioTracks = localStream.getAudioTracks()
      console.log('[AudioCapture] onopen audio tracks:', audioTracks.length, audioTracks.map(t => `${t.label}(${t.readyState})`))
      if (audioTracks.length === 0) {
        console.warn('[AudioCapture] no audio tracks — not starting recorder')
        return
      }

      const audioStream = new MediaStream(audioTracks)

      // iOS Safari does not support WebM — fall back to mp4.
      // faster-whisper uses ffmpeg which auto-detects format from content,
      // so the backend handles both formats without changes.
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
      ].find(t => MediaRecorder.isTypeSupported(t))

      if (!mimeType) {
        console.warn('[AudioCapture] No supported MediaRecorder format found on this device')
        ws.close()
        return
      }

      const recorder = new MediaRecorder(audioStream, { mimeType })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return

        if (chunkIdx.current === 0) {
          // First chunk contains the WebM container header — save as init segment.
          initChunk.current = e.data
        } else if (initChunk.current) {
          // Subsequent chunks are not independently decodable, so prepend the
          // init segment to produce a valid stand-alone WebM file each time.
          const blob = new Blob([initChunk.current, e.data], { type: mimeType })
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(blob)
          }
        }
        chunkIdx.current++
      }

      recorder.onerror = (e) => { console.error('[AudioCapture] recorder error:', e); stopCapture() }

      recorder.start(1500) // emit a chunk every 1.5 seconds
    }

    ws.onerror = (e) => {
      console.error('[AudioCapture] WS error:', e)
      ws.close()
    }

    return () => {
      console.log('[AudioCapture] cleanup — closing WS')
      stopCapture()
    }
  }, [enabled, localStream, peerId, stopCapture])
}
