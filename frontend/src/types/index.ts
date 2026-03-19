export interface User {
  id: string
  email: string
  username: string
  display_name: string
  language_code: 'en' | 'ro' | 'ja'
  is_admin: boolean
  created_at: string
}

export interface AuthResponse {
  token: string
  user: User
}

// What GET /api/users returns — email is deliberately absent (F5).
export interface PublicUser {
  id: string
  username: string
  display_name: string
  language_code: string
}

// Returned by GET /api/users/search — includes friendship state.
export interface SearchResult extends PublicUser {
  friend_status: 'none' | 'pending_sent' | 'pending_received' | 'accepted'
}

// A pending incoming friend request.
export interface IncomingRequest {
  friendship_id: string
  from: PublicUser
}

// A single message row from the DB.
export interface Message {
  id: string
  sender_id: string
  recipient_id: string
  original_text: string
  translated_text: string
  source_lang: string
  target_lang: string
  created_at: string
}

export const LANGUAGES = [
  { code: 'en' as const, label: 'English', flag: '🇬🇧' },
  { code: 'ro' as const, label: 'Romanian', flag: '🇷🇴' },
  { code: 'ja' as const, label: 'Japanese', flag: '🇯🇵' },
]
