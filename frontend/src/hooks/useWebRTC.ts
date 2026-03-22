import { useEffect, useRef, useState, useCallback } from 'react'
import { useWebSocketContext, useWebSocketEvent } from '../context/WebSocketContext'
import { api } from '../api/client'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'ended' | 'declined'

interface UseWebRTCOptions {
  callId: string
  peerId: string
  isInitiator: boolean
  onEnded: () => void
}

export function useWebRTC({ callId, peerId, isInitiator, onEnded }: UseWebRTCOptions) {
  const { send } = useWebSocketContext()
  const [callState, setCallState] = useState<CallState>(isInitiator ? 'ringing' : 'connecting')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [hasDualCamera, setHasDualCamera] = useState(false)

  const pcRef                  = useRef<RTCPeerConnection | null>(null)
  const localStreamRef         = useRef<MediaStream | null>(null)
  const acceptSentRef          = useRef(false)
  const offerSentRef           = useRef(false)
  const terminatedRef          = useRef(false)
  const facingModeRef          = useRef<'user' | 'environment'>('user')
  const pendingCandidates      = useRef<RTCIceCandidateInit[]>([])
  const iceDisconnectedTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callerTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ------------------------------------------------------------------
  // Resource cleanup
  // ------------------------------------------------------------------
  const cleanup = useCallback(() => {
    if (iceDisconnectedTimer.current) { clearTimeout(iceDisconnectedTimer.current); iceDisconnectedTimer.current = null }
    if (callerTimeoutRef.current)     { clearTimeout(callerTimeoutRef.current);     callerTimeoutRef.current = null }
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    pcRef.current?.close()
    pcRef.current         = null
    localStreamRef.current = null
  }, [])

  const terminate = useCallback((notifyPeer: boolean, declined = false) => {
    if (terminatedRef.current) return
    terminatedRef.current = true
    if (notifyPeer) {
      send({ type: 'call_hangup', to: peerId, call_id: callId })
      api.endCall(callId).catch(() => {})
    }
    cleanup()
    setLocalStream(null)
    setRemoteStream(null)
    setCallState(declined ? 'declined' : 'ended')
  }, [callId, peerId, send, cleanup])

  // ------------------------------------------------------------------
  // Drain queued ICE candidates after remote description is set
  // ------------------------------------------------------------------
  const drainCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingCandidates.current.splice(0)
    for (const init of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(init)) } catch { /* ignore */ }
    }
  }, [])

  // ------------------------------------------------------------------
  // PeerConnection factory
  // ------------------------------------------------------------------
  const getPC = useCallback(() => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      send({
        type: 'call_ice',
        to: peerId,
        call_id: callId,
        candidate: e.candidate.candidate,
        sdp_mid: e.candidate.sdpMid,
        sdp_mline_index: e.candidate.sdpMLineIndex,
      })
    }

    pc.ontrack = (e) => {
      console.log('[WebRTC] ontrack fired — streams:', e.streams.length, 'track kind:', e.track.kind)
      setRemoteStream(e.streams[0] ?? null)
      setCallState('active')
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      console.log('[WebRTC] iceConnectionState:', state)

      if (state === 'disconnected') {
        // Give the browser 5 s to recover before tearing down.
        iceDisconnectedTimer.current = setTimeout(() => {
          if (pcRef.current?.iceConnectionState === 'disconnected') {
            terminate(true)
          }
        }, 5000)
      } else if (state === 'connected' || state === 'completed') {
        if (iceDisconnectedTimer.current) {
          clearTimeout(iceDisconnectedTimer.current)
          iceDisconnectedTimer.current = null
        }
      } else if (state === 'failed' || state === 'closed') {
        terminate(true)
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] connectionState:', pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') terminate(true)
    }

    pcRef.current = pc
    return pc
  }, [callId, peerId, send, terminate])

  const attachLocalStream = useCallback(async (pc: RTCPeerConnection) => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (err) {
      console.error('[WebRTC] getUserMedia failed:', err)
      terminate(true)
      throw err
    }
    localStreamRef.current = stream
    setLocalStream(stream)
    stream.getTracks().forEach(t => pc.addTrack(t, stream))

    // Detect multiple cameras (labels available after getUserMedia).
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setHasDualCamera(devices.filter(d => d.kind === 'videoinput').length > 1)
    }).catch(() => {})

    return stream
  }, [terminate])

  // ------------------------------------------------------------------
  // Caller: send offer after call_accept
  // ------------------------------------------------------------------
  useWebSocketEvent('call_accept', useCallback(async (data) => {
    if (data.call_id !== callId || !isInitiator) return
    // Clear the no-answer timeout — peer picked up.
    if (callerTimeoutRef.current) { clearTimeout(callerTimeoutRef.current); callerTimeoutRef.current = null }
    if (offerSentRef.current) return
    offerSentRef.current = true
    const pc = getPC()
    await attachLocalStream(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await drainCandidates(pc)
    send({ type: 'call_offer', to: peerId, call_id: callId, sdp: offer.sdp })
    setCallState('connecting')
  }, [callId, isInitiator, getPC, attachLocalStream, drainCandidates, send, peerId]))

  // ------------------------------------------------------------------
  // Callee: receive offer, send answer
  // ------------------------------------------------------------------
  useWebSocketEvent('call_offer', useCallback(async (data) => {
    if (data.call_id !== callId || isInitiator) return
    const pc = getPC()
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp as string }))
    await drainCandidates(pc)
    await attachLocalStream(pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    send({ type: 'call_answer', to: peerId, call_id: callId, sdp: answer.sdp })
  }, [callId, isInitiator, getPC, attachLocalStream, drainCandidates, send, peerId]))

  // ------------------------------------------------------------------
  // Caller: receive answer
  // ------------------------------------------------------------------
  useWebSocketEvent('call_answer', useCallback(async (data) => {
    if (data.call_id !== callId || !isInitiator) return
    const pc = pcRef.current
    if (!pc) return
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp as string }))
    await drainCandidates(pc)
  }, [callId, isInitiator, drainCandidates]))

  // ------------------------------------------------------------------
  // ICE candidates — queue if remote description not set yet
  // ------------------------------------------------------------------
  useWebSocketEvent('call_ice', useCallback(async (data) => {
    if (data.call_id !== callId) return
    const init: RTCIceCandidateInit = {
      candidate:      data.candidate as string,
      sdpMid:         data.sdp_mid as string,
      sdpMLineIndex:  data.sdp_mline_index as number,
    }
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) {
      pendingCandidates.current.push(init)
      return
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(init)) } catch { /* ignore */ }
  }, [callId]))

  // ------------------------------------------------------------------
  // Remote hangup
  // ------------------------------------------------------------------
  useWebSocketEvent('call_hangup', useCallback((data) => {
    if (data.call_id !== callId) return
    terminate(false)
  }, [callId, terminate]))

  // ------------------------------------------------------------------
  // Remote declined (callee rejected or timed out without answering)
  // ------------------------------------------------------------------
  useWebSocketEvent('call_reject', useCallback((data) => {
    if (data.call_id !== callId) return
    terminate(false, true)
  }, [callId, terminate]))

  // ------------------------------------------------------------------
  // Callee: send call_accept once on mount.
  // Caller: start 45 s no-answer timeout.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isInitiator && !acceptSentRef.current) {
      acceptSentRef.current = true
      send({ type: 'call_accept', to: peerId, call_id: callId })
    }
    if (isInitiator) {
      callerTimeoutRef.current = setTimeout(() => {
        terminate(true)
      }, 45_000)
    }
    return () => { cleanup() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------
  const hangup = useCallback(() => { terminate(true) }, [terminate])

  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setMuted(v => !v)
  }, [])

  const toggleCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setCameraOff(v => !v)
  }, [])

  // Switch between front and back camera (mobile).
  const switchCamera = useCallback(async () => {
    const pc = pcRef.current
    const stream = localStreamRef.current
    if (!pc || !stream) return

    const nextFacing: 'user' | 'environment' =
      facingModeRef.current === 'user' ? 'environment' : 'user'

    let newStream: MediaStream
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      })
    } catch {
      return // requested camera not available
    }

    const [newVideoTrack] = newStream.getVideoTracks()

    // Replace the video track in the peer connection without renegotiation.
    const sender = pc.getSenders().find(s => s.track?.kind === 'video')
    if (sender) await sender.replaceTrack(newVideoTrack)

    // Stop the old video track and rebuild the local stream.
    stream.getVideoTracks().forEach(t => t.stop())
    const combined = new MediaStream([newVideoTrack, ...stream.getAudioTracks()])
    localStreamRef.current = combined
    setLocalStream(combined)
    facingModeRef.current = nextFacing
  }, [])

  return {
    callState,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    hasDualCamera,
    hangup,
    toggleMute,
    toggleCamera,
    switchCamera,
  }
}
