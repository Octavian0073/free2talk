import { useEffect, useRef, useState, useCallback } from 'react'
import { useWebSocketContext, useWebSocketEvent } from '../context/WebSocketContext'
import { api } from '../api/client'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'ended'

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

  const pcRef              = useRef<RTCPeerConnection | null>(null)
  const localStreamRef     = useRef<MediaStream | null>(null)
  const acceptSentRef      = useRef(false)
  const offerSentRef       = useRef(false)
  const terminatedRef      = useRef(false)
  // Queue ICE candidates that arrive before setRemoteDescription is called.
  const pendingCandidates  = useRef<RTCIceCandidateInit[]>([])

  // ------------------------------------------------------------------
  // Resource cleanup — no state changes (avoids StrictMode false-ended flash)
  // ------------------------------------------------------------------
  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    pcRef.current?.close()
    pcRef.current        = null
    localStreamRef.current = null
  }, [])

  const terminate = useCallback((notifyPeer: boolean) => {
    if (terminatedRef.current) return
    terminatedRef.current = true
    if (notifyPeer) {
      send({ type: 'call_hangup', to: peerId, call_id: callId })
      api.endCall(callId).catch(() => {})
    }
    cleanup()
    setLocalStream(null)
    setRemoteStream(null)
    setCallState('ended')
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
      console.log('[WebRTC] iceConnectionState:', pc.iceConnectionState)
    }

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] connectionState:', pc.connectionState)
      if (pc.connectionState === 'failed') terminate(true)
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
    return stream
  }, [terminate])

  // ------------------------------------------------------------------
  // Caller: send offer after call_accept (guarded against double-fire)
  // ------------------------------------------------------------------
  useWebSocketEvent('call_accept', useCallback(async (data) => {
    if (data.call_id !== callId || !isInitiator) return
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
      candidate:        data.candidate as string,
      sdpMid:           data.sdp_mid as string,
      sdpMLineIndex:    data.sdp_mline_index as number,
    }
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) {
      // Remote description not ready yet — queue for later
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
  // Callee: send call_accept once on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isInitiator && !acceptSentRef.current) {
      acceptSentRef.current = true
      send({ type: 'call_accept', to: peerId, call_id: callId })
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

  return { callState, localStream, remoteStream, muted, cameraOff, hangup, toggleMute, toggleCamera }
}
