import { useState, useEffect, useRef } from 'react'
import type { PublicUser, SearchResult, IncomingRequest } from '../types'
import { LANGUAGES } from '../types'
import { api } from '../api/client'

interface Props {
  friends: PublicUser[]
  selectedId: string | null
  onSelect: (c: PublicUser) => void
  onFriendAccepted: () => void
}

export default function ConversationSidebar({ friends, selectedId, onSelect, onFriendAccepted }: Props) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [requests, setRequests] = useState<IncomingRequest[]>([])
  const [showRequests, setShowRequests] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load incoming friend requests on mount.
  useEffect(() => {
    api.getFriendRequests().then(setRequests).catch(console.error)
  }, [])

  // Debounced search: fires 400ms after the user stops typing.
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
    try {
      await api.sendFriendRequest(username)
      // Refresh search results to show updated status.
      const res = await api.searchUsers(query.trim())
      setSearchResults(res)
    } catch (err) {
      console.error('friend request failed:', err)
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
          placeholder="Search @username to add friends"
          className="w-full bg-gray-800 text-sm text-white rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-500"
        />
      </div>

      {/* Incoming requests toggle */}
      {requests.length > 0 && !isSearching && (
        <button
          onClick={() => setShowRequests(v => !v)}
          className="flex items-center justify-between px-4 py-2 text-xs text-indigo-400 hover:bg-gray-800 transition-colors border-b border-gray-800"
        >
          <span>Friend requests ({requests.length})</span>
          <span>{showRequests ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Incoming requests panel */}
      {showRequests && !isSearching && (
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
                Accept
              </button>
              <button
                onClick={() => handleDecline(req)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors"
              >
                Decline
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Search results */}
      {isSearching ? (
        <ul className="flex-1 overflow-y-auto">
          {searching && (
            <li className="px-4 py-3 text-xs text-gray-600">Searching…</li>
          )}
          {!searching && searchResults.length === 0 && (
            <li className="px-4 py-3 text-xs text-gray-600">No users found.</li>
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
                <FriendActionButton status={result.friend_status} username={result.username} onAdd={handleAddFriend} />
              </li>
            )
          })}
        </ul>
      ) : (
        /* Friends list */
        <ul className="flex-1 overflow-y-auto">
          {friends.length === 0 ? (
            <li className="flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
              <p className="text-gray-600 text-sm">No friends yet.</p>
              <p className="text-gray-700 text-xs">Search by @username above to add friends.</p>
            </li>
          ) : (
            friends.map(friend => {
              const lang = LANGUAGES.find(l => l.code === friend.language_code)
              const active = friend.id === selectedId
              return (
                <li key={friend.id}>
                  <button
                    onClick={() => onSelect(friend)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left ${
                      active ? 'bg-gray-800' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-semibold select-none flex-shrink-0">
                      {friend.display_name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{friend.display_name}</p>
                      <p className="text-xs text-gray-500 truncate">@{friend.username} · {lang?.flag} {lang?.label}</p>
                    </div>
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
  if (status === 'accepted') {
    return <span className="text-xs text-gray-500">Friends</span>
  }
  if (status === 'pending_sent') {
    return <span className="text-xs text-gray-500">Pending</span>
  }
  if (status === 'pending_received') {
    return <span className="text-xs text-indigo-400">Check requests</span>
  }
  return (
    <button
      onClick={() => onAdd(username)}
      className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors flex-shrink-0"
    >
      Add
    </button>
  )
}
