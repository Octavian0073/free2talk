import { useEffect, useRef, useState } from 'react'
import type { PublicUser, User, Message } from '../types'
import { LANGUAGES } from '../types'
import { api } from '../api/client'
import EmojiPicker from './EmojiPicker'
import { useUILang } from '../context/UILangContext'

interface Props {
  contact: PublicUser
  currentUser: User
  messages: Message[]
  onMessageSent: (msg: Message) => void
  onHistoryLoaded: (msgs: Message[]) => void
  onCallStart: (call: { callId: string; peerId: string; peerName: string; isInitiator: boolean }) => void
  onBack: () => void
  onUnfriend: (contactId: string) => void
}

export default function ConversationPane({
  contact,
  currentUser,
  messages,
  onMessageSent,
  onHistoryLoaded,
  onCallStart,
  onBack,
  onUnfriend,
}: Props) {
  const { T } = useUILang()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showContactMenu, setShowContactMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [unfriending, setUnfriending] = useState(false)
  const [isFriend, setIsFriend] = useState(true)
  const [addBackStatus, setAddBackStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const contactMenuRef = useRef<HTMLDivElement>(null)

  const contactLang = LANGUAGES.find(l => l.code === contact.language_code)
  const myLang = LANGUAGES.find(l => l.code === currentUser.language_code)

  useEffect(() => {
    setLoadingHistory(true)
    api.getHistory(contact.id)
      .then(onHistoryLoaded)
      .catch(console.error)
      .finally(() => setLoadingHistory(false))
  }, [contact.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Close contact menu on outside click.
  useEffect(() => {
    if (!showContactMenu) return
    const handler = (e: MouseEvent) => {
      if (contactMenuRef.current && !contactMenuRef.current.contains(e.target as Node)) {
        setShowContactMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showContactMenu])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      const msg = await api.sendMessage(contact.id, trimmed)
      setText('')
      onMessageSent(msg)
    } catch (err) {
      console.error('send failed:', err)
    } finally {
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmojiSelect = (emoji: string) => {
    setText(prev => prev + emoji)
    setShowEmojiPicker(false)
    inputRef.current?.focus()
  }

  const handleUnfriend = async () => {
    setUnfriending(true)
    try {
      await api.unfriendUser(contact.id)
      setIsFriend(false)
      setShowContactMenu(false)
      onUnfriend(contact.id) // removes from sidebar; pane stays open
    } catch (err) {
      console.error('unfriend failed:', err)
    } finally {
      setUnfriending(false)
    }
  }

  const handleAddBack = async () => {
    setAddBackStatus('sending')
    try {
      await api.sendFriendRequest(contact.username)
      setAddBackStatus('sent')
      setShowContactMenu(false)
    } catch {
      setAddBackStatus('idle')
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">

      {/* Header */}
      <div className="relative flex-shrink-0" ref={contactMenuRef}>
        <div className="flex items-center gap-3 px-3 py-3 border-b border-gray-800">

          {/* Back button — mobile only */}
          <button
            onClick={onBack}
            className="md:hidden flex-shrink-0 text-gray-400 hover:text-white p-2 -ml-1 rounded-lg transition-colors"
            title={T.back}
          >
            <BackIcon />
          </button>

          {/* Contact info — clickable to open menu */}
          <button
            onClick={() => setShowContactMenu(v => !v)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-lg hover:bg-gray-800 px-1 py-0.5 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-semibold select-none flex-shrink-0">
              {contact.display_name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{contact.display_name}</p>
              <p className="text-xs text-gray-500 truncate">
                {contactLang?.flag} {contactLang?.label} {T.youSee(myLang?.label ?? '')}
              </p>
            </div>
            <ChevronIcon open={showContactMenu} />
          </button>

          {/* Video call button */}
          <button
            onClick={async () => {
              try {
                const { call_id } = await api.initiateCall(contact.id)
                onCallStart({ callId: call_id, peerId: contact.id, peerName: contact.display_name, isInitiator: true })
              } catch (err) {
                console.error('call failed to start:', err)
              }
            }}
            title={T.startVideoCall}
            className="flex-shrink-0 text-gray-400 hover:text-white p-2 rounded-lg transition-colors"
          >
            <VideoIcon />
          </button>
        </div>

        {/* Contact action menu */}
        {showContactMenu && (
          <div className="absolute top-full left-0 right-0 border-b border-gray-700 shadow-lg z-10 bg-gray-900">
            <div className="px-4 py-2">
              {isFriend ? (
                <button
                  onClick={handleUnfriend}
                  disabled={unfriending}
                  className="flex items-center gap-2 w-full text-left text-sm text-red-400 hover:text-red-300 hover:bg-gray-800 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <UnfriendIcon />
                  {unfriending ? T.removing : `${T.unfriend} ${contact.display_name}`}
                </button>
              ) : addBackStatus === 'sent' ? (
                <p className="text-xs text-indigo-400 px-3 py-2">
                  {T.friendRequestSent(contact.display_name)}
                </p>
              ) : (
                <button
                  onClick={handleAddBack}
                  disabled={addBackStatus === 'sending'}
                  className="flex items-center gap-2 w-full text-left text-sm text-indigo-400 hover:text-indigo-300 hover:bg-gray-800 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <AddBackIcon />
                  {addBackStatus === 'sending' ? T.sending : `${T.addBack} ${contact.display_name}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {loadingHistory ? (
          <p className="text-center text-gray-600 text-xs mt-8">{T.loadingMessages}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-700 text-xs mt-8">
            {T.beginningOfConvo(contact.display_name)}
          </p>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.sender_id === currentUser.id}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Not-friends banner */}
      {!isFriend && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-t border-gray-700 text-xs text-gray-400 flex-shrink-0">
          <span>{T.noLongerFriends}</span>
          {addBackStatus !== 'sent' && (
            <button
              onClick={handleAddBack}
              disabled={addBackStatus === 'sending'}
              className="text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-50 transition-colors"
            >
              {addBackStatus === 'sending' ? T.sending : T.addBack}
            </button>
          )}
          {addBackStatus === 'sent' && (
            <span className="text-indigo-400">{T.requestSent}</span>
          )}
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-3 border-t border-gray-800 flex-shrink-0">
        {/* Emoji button */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowEmojiPicker(v => !v)}
            title="Emoji"
            className="text-gray-400 hover:text-yellow-400 p-2 rounded-lg transition-colors text-lg leading-none"
          >
            😊
          </button>
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isFriend ? T.writeInLang(myLang?.label ?? 'your language') : T.addBackToSend}
          disabled={sending || !isFriend}
          className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm outline-none placeholder-gray-600 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim() || !isFriend}
          className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors"
        >
          {sending ? '…' : T.send}
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const { T } = useUILang()
  const displayText = isOwn ? msg.original_text : msg.translated_text

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isOwn
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-gray-800 text-gray-100 rounded-bl-sm'
        }`}
      >
        <p>{displayText}</p>
        {!isOwn && msg.translation_failed && (
          <p className="text-[10px] mt-0.5 text-yellow-500">{T.translationUnavailable}</p>
        )}
        <p className={`text-[10px] mt-1 ${isOwn ? 'text-indigo-200 text-right' : 'text-gray-500'}`}>
          {formatTime(msg.created_at)}
        </p>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function BackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className={`flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function UnfriendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 10H16M9 11a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0H2z" />
    </svg>
  )
}

function AddBackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3M9 11a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0H2z" />
    </svg>
  )
}
