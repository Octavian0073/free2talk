// Admin API client — all requests require a valid admin JWT
const BASE = '/api/admin'

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.trim() || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface AdminStats {
  total_users: number
  total_messages: number
  total_calls: number
  active_calls: number
}

export interface AdminUser {
  id: string
  email: string
  display_name: string
  language_code: string
  is_admin: boolean
  created_at: string
}

export interface AdminMessage {
  id: string
  sender_id: string
  sender_name: string
  recipient_id: string
  recipient_name: string
  original_text: string
  translated_text: string
  source_lang: string
  target_lang: string
  created_at: string
}

export interface AuditEntry {
  id: string
  admin_id: string
  admin_name: string
  action: string
  target_id: string
  detail: string
  ip_address: string
  created_at: string
}

export const adminApi = {
  stats: () => request<AdminStats>('/stats'),
  listUsers: () => request<AdminUser[]>('/users'),
  toggleAdmin: (id: string) => request<AdminUser>(`/users/${id}/toggle-admin`, { method: 'PUT' }),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),
  listMessages: () => request<AdminMessage[]>('/messages'),
  listAudit: () => request<AuditEntry[]>('/audit'),
}
