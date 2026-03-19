import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { LANGUAGES } from '../types'
import type { PublicUser, Message } from '../types'
import { api } from '../api/client'
import { useWebSocket } from '../hooks/useWebSocket'
import ConversationSidebar from '../components/ConversationSidebar'
import ConversationPane from '../components/ConversationPane'
import IncomingCallModal from '../components/IncomingCallModal'
import CallOverlay from '../components/CallOverlay'
import type { IncomingCall } from '../components/IncomingCallModal'

interface ActiveCall {
  callId: string
  peerId: string
  peerName: string
  isInitiator: boolean
}

export default function ChatApp() {
  const { user, logout } = useAuth()
  const [friends, setFriends] = useState<PublicUser[]>([])
  const [selectedContact, setSelectedContact] = useState<PublicUser | null>(null)
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({})
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const lang = LANGUAGES.find(l => l.code === user?.language_code)

  const loadFriends = useCallback(() => {
    api.getFriends().then(setFriends).catch(console.error)
  }, [])

  useEffect(() => { loadFriends() }, [loadFriends])

  const handleIncomingMessage = useCallback((msg: Message) => {
    setMessageMap(prev => ({
      ...prev,
      [msg.sender_id]: [...(prev[msg.sender_id] ?? []), msg],
    }))
  }, [])

  useWebSocket({ onMessage: handleIncomingMessage, enabled: !!user })

  const handleMessageSent = useCallback((msg: Message) => {
    setMessageMap(prev => ({
      ...prev,
      [msg.recipient_id]: [...(prev[msg.recipient_id] ?? []), msg],
    }))
  }, [])

  const handleCallStart = useCallback((call: ActiveCall) => {
    setActiveCall(call)
  }, [])

  const handleAcceptCall = useCallback((incoming: IncomingCall) => {
    setActiveCall({
      callId: incoming.callId,
      peerId: incoming.fromId,
      peerName: incoming.fromName,
      isInitiator: false,
    })
  }, [])

  const handleDeclineCall = useCallback((incoming: IncomingCall) => {
    api.endCall(incoming.callId).catch(() => {})
  }, [])

  // On mobile the layout is single-panel: sidebar when no contact selected,
  // conversation pane when a contact is selected.
  const showSidebar   = !selectedContact
  const showPane      = !!selectedContact

  return (
    <div className="flex h-dvh bg-gray-900 text-white overflow-hidden">

      {/* ── Sidebar ────────────────────────────────────────────────────
          Desktop: always visible at fixed width.
          Mobile:  full-screen when no contact is selected.           */}
      <aside className={`
        flex flex-col border-r border-gray-800 bg-gray-900
        ${showSidebar ? 'flex' : 'hidden'}
        md:flex w-full md:w-80 flex-shrink-0
      `}>
        {/* Profile bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-semibold select-none">
              {user?.display_name?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">{user?.display_name}</p>
              <p className="text-xs text-gray-500">
                @{user?.username} · {lang?.flag} {lang?.label}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-gray-500 hover:text-gray-300 transition-colors text-xs px-2 py-1 rounded"
          >
            Sign out
          </button>
        </div>

        <ConversationSidebar
          friends={friends}
          selectedId={selectedContact?.id ?? null}
          onSelect={setSelectedContact}
          onFriendAccepted={loadFriends}
        />
      </aside>

      {/* ── Conversation pane ──────────────────────────────────────────
          Desktop: always visible, flex-1.
          Mobile:  full-screen when a contact is selected.            */}
      <main className={`
        flex-1 flex flex-col min-w-0
        ${showPane ? 'flex' : 'hidden'}
        md:flex
      `}>
        {selectedContact && user ? (
          <ConversationPane
            contact={selectedContact}
            currentUser={user}
            messages={messageMap[selectedContact.id] ?? []}
            onMessageSent={handleMessageSent}
            onHistoryLoaded={(msgs) =>
              setMessageMap(prev => ({ ...prev, [selectedContact.id]: msgs }))
            }
            onCallStart={handleCallStart}
            onBack={() => setSelectedContact(null)}
          />
        ) : (
          <EmptyState />
        )}
      </main>

      {/* Incoming call modal — rendered above everything */}
      <IncomingCallModal onAccept={handleAcceptCall} onDecline={handleDeclineCall} />

      {/* Active call overlay — covers the full screen */}
      {activeCall && (
        <CallOverlay
          callId={activeCall.callId}
          peerId={activeCall.peerId}
          peerName={activeCall.peerName}
          isInitiator={activeCall.isInitiator}
          onEnded={() => setActiveCall(null)}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 bg-gray-900">
      <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-4xl select-none">
        💬
      </div>
      <div>
        <p className="text-xl font-semibold text-white">free2talk</p>
        <p className="text-gray-500 text-sm mt-1">Select a conversation to start talking.</p>
        <p className="text-gray-600 text-xs mt-3">Messages are translated in real time.</p>
      </div>
    </div>
  )
}
