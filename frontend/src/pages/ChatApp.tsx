import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
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
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<PublicUser | null>(null)
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>({})
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const lang = LANGUAGES.find(l => l.code === user?.language_code)

  // Ref so that handleIncomingMessage (stable useCallback) can read the
  // latest selected contact without being re-created on every selection change.
  const selectedContactRef = useRef<PublicUser | null>(null)
  useEffect(() => { selectedContactRef.current = selectedContact }, [selectedContact])

  const loadFriends = useCallback(() => {
    setFriendsLoading(true)
    api.getFriends()
      .then(setFriends)
      .catch(console.error)
      .finally(() => setFriendsLoading(false))
  }, [])

  useEffect(() => { loadFriends() }, [loadFriends])

  // Re-fetch when the user returns to the tab — handles cases where the
  // initial load failed silently (transient network error on page refresh).
  useEffect(() => {
    const onFocus = () => loadFriends()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadFriends])

  const handleIncomingMessage = useCallback((msg: Message) => {
    setMessageMap(prev => ({
      ...prev,
      [msg.sender_id]: [...(prev[msg.sender_id] ?? []), msg],
    }))
    // Increment unread only when the conversation with this sender is not open.
    if (msg.sender_id !== selectedContactRef.current?.id) {
      setUnreadCounts(prev => ({ ...prev, [msg.sender_id]: (prev[msg.sender_id] ?? 0) + 1 }))
    }
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

  const handleSelectContact = useCallback((contact: PublicUser) => {
    setSelectedContact(contact)
    setUnreadCounts(prev => ({ ...prev, [contact.id]: 0 }))
  }, [])

  const handleUnfriend = useCallback((contactId: string) => {
    setFriends(prev => prev.filter(f => f.id !== contactId))
    setSelectedContact(null)
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
          <Link to="/profile" className="flex items-center gap-3 rounded-lg hover:bg-gray-800 px-1 py-0.5 transition-colors group">
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-semibold select-none group-hover:bg-indigo-500 transition-colors">
              {user?.display_name?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">{user?.display_name}</p>
              <p className="text-xs text-gray-500">
                @{user?.username} · {lang?.flag} {lang?.label}
              </p>
            </div>
          </Link>
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
          friendsLoading={friendsLoading}
          selectedId={selectedContact?.id ?? null}
          unreadCounts={unreadCounts}
          onSelect={handleSelectContact}
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
            onUnfriend={handleUnfriend}
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
