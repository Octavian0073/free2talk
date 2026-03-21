import { useEffect, useRef } from 'react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useAudioCapture } from '../hooks/useAudioCapture'
import CaptionOverlay from './CaptionOverlay'

interface Props {
  callId: string
  peerId: string
  peerName: string
  isInitiator: boolean
  onEnded: () => void
}

export default function CallOverlay({ callId, peerId, peerName, isInitiator, onEnded }: Props) {
  const {
    callState, localStream, remoteStream,
    muted, cameraOff, hasDualCamera,
    hangup, toggleMute, toggleCamera, switchCamera,
  } = useWebRTC({ callId, peerId, isInitiator, onEnded })

  useAudioCapture({ peerId, localStream, enabled: callState === 'active' })

  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Auto-close 1.5 s after the call ends or is declined.
  useEffect(() => {
    if (callState !== 'ended' && callState !== 'declined') return
    const t = setTimeout(onEnded, 1500)
    return () => clearTimeout(t)
  }, [callState, onEnded])

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream
  }, [remoteStream])

  const stateLabel: Record<typeof callState, string> = {
    idle:       'Starting…',
    ringing:    'Ringing…',
    connecting: 'Connecting…',
    active:     '',
    ended:      'Call ended',
    declined:   'Call declined',
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 flex flex-col">

      {/* Remote video / avatar */}
      <div className="flex-1 relative flex items-center justify-center bg-gray-900 min-h-0">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            disablePictureInPicture
            className="w-full h-full object-cover [&::-webkit-media-controls]{display:none}"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-24 h-24 rounded-full bg-indigo-700 flex items-center justify-center text-4xl font-bold select-none">
              {peerName[0].toUpperCase()}
            </div>
            <p className="text-white text-xl font-semibold">{peerName}</p>
            {stateLabel[callState] && (
              <p className="text-gray-400 text-base">{stateLabel[callState]}</p>
            )}
          </div>
        )}

        {/* Captions */}
        <CaptionOverlay />

        {/* Local video — picture-in-picture */}
        {localStream && (
          <div className="absolute top-3 left-3 w-20 md:w-28 rounded-xl overflow-hidden shadow-xl border border-gray-700 aspect-[9/16]">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              disablePictureInPicture
              className="w-full h-full object-cover [&::-webkit-media-controls]{display:none}"
            />
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-center gap-6 py-6 bg-gray-900 border-t border-gray-800 flex-shrink-0">
        <ControlButton
          onClick={toggleMute}
          active={muted}
          label={muted ? 'Unmute' : 'Mute'}
          icon={muted ? '🔇' : '🎙️'}
        />
        <ControlButton
          onClick={toggleCamera}
          active={cameraOff}
          label={cameraOff ? 'Camera on' : 'Camera off'}
          icon={cameraOff ? '📷' : '📹'}
        />
        {/* Switch camera — only shown when device has front + back cameras */}
        {hasDualCamera && (
          <ControlButton
            onClick={switchCamera}
            active={false}
            label="Switch camera"
            icon="🔄"
          />
        )}
        {/* End call — prominent red */}
        <button
          onClick={hangup}
          className="bg-red-600 active:bg-red-700 hover:bg-red-500 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl shadow-lg transition-colors"
          title="End call"
        >
          📵
        </button>
      </div>
    </div>
  )
}

function ControlButton({ onClick, active, label, icon }: {
  onClick: () => void
  active: boolean
  label: string
  icon: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-full w-14 h-14 flex items-center justify-center text-xl transition-colors shadow active:scale-95 ${
        active ? 'bg-gray-500 hover:bg-gray-400' : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {icon}
    </button>
  )
}
