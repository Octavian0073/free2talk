import { useState, useEffect, useRef } from 'react'
import type { PublicUser, SearchResult, IncomingRequest } from '../types'
import { LANGUAGES } from '../types'
import { api } from '../api/client'
import { useUILang } from '../context/UILangContext'

interface Props {
  friends: PublicUser[]
  friendsLoading: boolean
  selectedId: string | null
  unreadCounts: Record<string, number>
  onSelect: (c: PublicUser) => void
  onFriendAccepted: () => void
}

export default function ConversationSidebar({ friends, friendsLoading, selectedId, unreadCounts, onSelect, onFriendAccepted }: Props) {
  const { T } = useUILang()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [requests, setRequests] = useState<IncomingRequest[]>([])
  const [showRequests, setShowRequests] = useState(false)
  const [pendingUsernames, setPendingUsernames] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.getFriendRequests().then(setRequests).catch(console.error)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.searchUsers(query.trim())
        setSearchResults(res)
      } catch {
        // silently ignore search errors
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const handleAddFriend = async (username: string) => {
    setPendingUsernames(prev => new Set([...prev, username]))
    try {
      await api.sendFriendRequest(username)
    } catch (err) {
      setPendingUsernames(prev => { const s = new Set(prev); s.delete(username); return s })
      console.error('friend request failed:', err)
      return
    }
    try {
      const res = await api.searchUsers(query.trim())
      setSearchResults(res)
    } catch {
      // silently ignore
    }
  }

  const handleAccept = async (req: IncomingRequest) => {
    try {
      await api.acceptFriendRequest(req.friendship_id)
      setRequests(prev => prev.filter(r => r.friendship_id !== req.friendship_id))
      onFriendAccepted()
    } catch (err) {
      console.error('accept failed:', err)
    }
  }

  const handleDecline = async (req: IncomingRequest) => {
    try {
      await api.declineOrRemoveFriend(req.friendship_id)
      setRequests(prev => prev.filter(r => r.friendship_id !== req.friendship_id))
    } catch (err) {
      console.error('decline failed:', err)
    }
  }

  const isSearching = query.trim().length > 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={T.searchPlaceholder}
          className="w-full bg-gray-800 text-sm text-white rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-500"
        />
      </div>

      {/* Incoming requests toggle */}
      {requests.length > 0 && !isSearching && (
        <button
          onClick={() => setShowRequests(v => !v)}
          className="flex items-center justify-between px-4 py-2 text-xs text-indigo-400 hover:bg-gray-800 transition-colors border-b border-gray-800"
        >
          <span>{T.friendRequests} ({requests.length})</span>
          <span>{showRequests ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Incoming requests panel */}
      {showRequests && requests.length > 0 && !isSearching && (
        <ul className="border-b border-gray-800 bg-gray-900">
          {requests.map(req => (
            <li key={req.friendship_id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-semibold flex-shrink-0 select-none">
                {req.from.display_name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{req.from.display_name}</p>
                <p className="text-xs text-gray-500">@{req.from.username}</p>
              </div>
              <button
                onClick={() => handleAccept(req)}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors"
              >
                {T.accept}
              </button>
              <button
                onClick={() => handleDecline(req)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
              >
                {T.decline}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Search results */}
      {isSearching ? (
        <ul className="flex-1 overflow-y-auto">
          {searching && (
            <li className="px-4 py-3 text-xs text-gray-600">{T.searching}</li>
          )}
          {!searching && searchResults.length === 0 && (
            <li className="px-4 py-3 text-xs text-gray-600">{T.noUsersFound}</li>
          )}
          {searchResults.map(result => {
            const lang = LANGUAGES.find(l => l.code === result.language_code)
            return (
              <li key={result.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors">
                <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-semibold select-none flex-shrink-0">
                  {result.display_name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{result.display_name}</p>
                  <p className="text-xs text-gray-500">@{result.username} · {lang?.flag}</p>
                </div>
                <FriendActionButton
                  status={pendingUsernames.has(result.username) ? 'pending_sent' : result.friend_status}
                  username={result.username}
                  onAdd={handleAddFriend}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {friendsLoading && friends.length === 0 ? (
            <li className="px-4 py-6 text-xs text-gray-600 text-center">{T.loading}</li>
          ) : friends.length === 0 ? (
            <li className="flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
              <p className="text-gray-600 text-sm">{T.noFriendsYet}</p>
              <p className="text-gray-700 text-xs">{T.noFriendsHint}</p>
            </li>
          ) : (
            friends.map(friend => {
              const lang = LANGUAGES.find(l => l.code === friend.language_code)
              const active = friend.id === selectedId
              const unread = unreadCounts[friend.id] ?? 0
              return (
                <li key={friend.id}>
                  <button
                    onClick={() => onSelect(friend)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left ${
                      active ? 'bg-gray-800' : ''
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-semibold select-none">
                        {friend.display_name[0].toUpperCase()}
                      </div>
                      {unread > 0 && !active && (
                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-indigo-400 rounded-full border-2 border-gray-900" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${unread > 0 && !active ? 'font-bold text-white' : 'font-medium'}`}>
                        {friend.display_name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">@{friend.username} · {lang?.flag} {lang?.label}</p>
                    </div>
                    {unread > 0 && !active && (
                      <span className="flex-shrink-0 min-w-[20px] h-5 bg-indigo-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center px-1.5">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

interface FriendActionButtonProps {
  status: SearchResult['friend_status']
  username: string
  onAdd: (username: string) => void
}

function FriendActionButton({ status, username, onAdd }: FriendActionButtonProps) {
  const { T } = useUILang()
  if (status === 'accepted') {
    return <span className="text-xs text-gray-500">{T.friends}</span>
  }
  if (status === 'pending_sent') {
    return <span className="text-xs text-indigo-400 bg-indigo-950 px-2 py-1 rounded-full">{T.requested}</span>
  }
  if (status === 'pending_received') {
    return <span className="text-xs text-indigo-400">{T.checkRequests}</span>
  }
  return (
    <button
      onClick={() => onAdd(username)}
      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors flex-shrink-0"
    >
      {T.add}
    </button>
  )
}
