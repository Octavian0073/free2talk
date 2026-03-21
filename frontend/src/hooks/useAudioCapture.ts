import { useEffect, useRef, useCallback, useState } from 'react'

const WS_AUDIO_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/audio`

// AudioWorklet processor script (served from public/).
const WORKLET_URL = '/audio-processor.js'

// Capture and transmit at 16 kHz — matches Whisper's expected sample rate.
// The AudioContext resamples the microphone stream transparently.
const SAMPLE_RATE = 16000

interface UseAudioCaptureOptions {
  peerId: string
  localStream: MediaStream | null
  enabled: boolean
}

export function useAudioCapture({ peerId, localStream, enabled }: UseAudioCaptureOptions) {
  const wsRef      = useRef<WebSocket | null>(null)
  const ctxRef     = useRef<AudioContext | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const stopCapture = useCallback(() => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    ctxRef.current?.close()
    ctxRef.current = null
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled || !localStream || !peerId) return

    const token = localStorage.getItem('token')
    if (!token) return

    const audioTracks = localStream.getAudioTracks()
    if (audioTracks.length === 0) return

    const ws = new WebSocket(
      `${WS_AUDIO_BASE}?token=${encodeURIComponent(token)}&to_id=${encodeURIComponent(peerId)}`
    )
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onclose = (e) => {
      const intentional = e.code === 1000 || e.code === 1005
      if (!intentional && enabled && localStream && peerId) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          setRetryCount(c => c + 1)
        }, 3000)
      }
    }

    ws.onopen = async () => {
      try {
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        ctxRef.current = ctx

        await ctx.audioWorklet.addModule(WORKLET_URL)

        const source  = ctx.createMediaStreamSource(new MediaStream(audioTracks))
        const worklet = new AudioWorkletNode(ctx, 'audio-processor')

        // Route worklet output through a silent gain node to keep the audio
        // graph active in all browsers without playing anything audible.
        const silence = ctx.createGain()
        silence.gain.value = 0
        worklet.connect(silence)
        silence.connect(ctx.destination)

        worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(e.data)
          }
        }

        source.connect(worklet)
      } catch (err) {
        console.error('[AudioCapture] AudioWorklet init failed:', err)
        ws.close()
      }
    }

    ws.onerror = (e) => {
      console.error('[AudioCapture] WS error:', e)
      ws.close()
    }

    return () => stopCapture()
  }, [enabled, localStream, peerId, stopCapture, retryCount])
}
