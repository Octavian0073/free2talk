import type { User, AuthResponse, PublicUser, Message, SearchResult, IncomingRequest } from '../types'

const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.trim() || `HTTP ${res.status}`)
  }
  if (res.status === 200 && res.headers.get('content-length') === '0') return undefined as T
  if (res.status === 202 || res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export const api = {
  register: (body: { email: string; password: string; display_name: string; language_code: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  getMe: () => request<User>('/user/me'),

  updateLanguage: (language_code: string) =>
    request<User>('/user/language', { method: 'PUT', body: JSON.stringify({ language_code }) }),

  // Phase 2 — chat
  getUsers: () => request<PublicUser[]>('/users'),

  sendMessage: (recipient_id: string, text: string) =>
    request<Message>('/messages', { method: 'POST', body: JSON.stringify({ recipient_id, text }) }),

  getHistory: (userId: string) => request<Message[]>(`/messages/${userId}`),

  // Phase 2.5 — friends
  searchUsers: (q: string) => request<SearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`),

  getFriends: () => request<PublicUser[]>('/friends'),

  getFriendRequests: () => request<IncomingRequest[]>('/friends/requests'),

  sendFriendRequest: (username: string) =>
    request<void>('/friends/request', { method: 'POST', body: JSON.stringify({ username }) }),

  acceptFriendRequest: (friendshipId: string) =>
    request<void>(`/friends/accept/${friendshipId}`, { method: 'POST' }),

  declineOrRemoveFriend: (friendshipId: string) =>
    request<void>(`/friends/${friendshipId}`, { method: 'DELETE' }),

  unfriendUser: (userId: string) =>
    request<void>(`/friends/user/${userId}`, { method: 'DELETE' }),

  updateProfile: (body: { display_name: string; email: string; language_code: string; password: string }) =>
    request<User>('/user/profile', { method: 'PUT', body: JSON.stringify(body) }),

  // ML warmup — streams SSE from Go while Modal cold-starts.
  // Calls onTick(elapsed) every second and resolves when ready.
  warmupML: (onTick: (elapsed: number) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const token = getToken()
      const url = `${BASE}/ml/warmup${token ? `?token=${encodeURIComponent(token)}` : ''}`
      const es = new EventSource(url)
      es.addEventListener('warming', (e) => {
        const { elapsed } = JSON.parse((e as MessageEvent).data)
        onTick(elapsed)
      })
      es.addEventListener('ready', () => { es.close(); resolve() })
      es.addEventListener('error', () => { es.close(); reject(new Error('ML service unreachable')) })
    })
  },

  // Phase 3 — calls
  initiateCall: (callee_id: string) =>
    request<{ call_id: string }>('/calls', { method: 'POST', body: JSON.stringify({ callee_id }) }),

  endCall: (callId: string) =>
    request<void>(`/calls/${callId}/end`, { method: 'PATCH' }),
}
