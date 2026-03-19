import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { adminApi, type AdminStats, type AdminUser, type AdminMessage, type AuditEntry } from '../api/admin'
import { LANGUAGES } from '../types'

type Tab = 'stats' | 'users' | 'messages' | 'audit'

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState<Tab>('stats')

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">free2talk</span>
          <span className="text-xs bg-indigo-700 rounded px-2 py-0.5 font-medium">Admin</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{user?.display_name}</span>
          <button onClick={logout} className="hover:text-white transition-colors">Sign out</button>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 px-6 pt-4 border-b border-gray-800 bg-gray-900">
        {(['stats', 'users', 'messages'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg capitalize transition-colors ${
              tab === t
                ? 'bg-gray-800 text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        {tab === 'stats'    && <StatsPanel />}
        {tab === 'users'    && <UsersPanel />}
        {tab === 'messages' && <MessagesPanel />}
        {tab === 'audit'    && <AuditPanel />}
      </main>
    </div>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.stats()
      .then(setStats)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <ErrorBox message={error} />
  if (!stats) return <Loading />

  const cards = [
    { label: 'Total Users', value: stats.total_users },
    { label: 'Total Messages', value: stats.total_messages },
    { label: 'Total Calls', value: stats.total_calls },
    { label: 'Active Calls', value: stats.active_calls, highlight: stats.active_calls > 0 },
  ]

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Overview</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div
            key={c.label}
            className={`rounded-xl p-5 border ${
              c.highlight ? 'border-indigo-500 bg-indigo-900/20' : 'border-gray-800 bg-gray-900'
            }`}
          >
            <p className="text-3xl font-bold">{c.value.toLocaleString()}</p>
            <p className="text-gray-400 text-sm mt-1">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersPanel() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    adminApi.listUsers()
      .then(setUsers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleToggleAdmin = async (id: string) => {
    try {
      const updated = await adminApi.toggleAdmin(id)
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return
    try {
      await adminApi.deleteUser(id)
      setUsers(prev => prev.filter(u => u.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  if (error) return <ErrorBox message={error} />
  if (loading) return <Loading />

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Users ({users.length})</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Language</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {users.map(u => {
              const lang = LANGUAGES.find(l => l.code === u.language_code)
              const isSelf = u.id === currentUser?.id
              return (
                <tr key={u.id} className="bg-gray-900/50 hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    {u.display_name}
                    {isSelf && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{u.email}</td>
                  <td className="px-4 py-3">{lang?.flag} {lang?.label}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      u.is_admin ? 'bg-indigo-700 text-white' : 'bg-gray-800 text-gray-400'
                    }`}>
                      {u.is_admin ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleAdmin(u.id)}
                        disabled={isSelf}
                        title={isSelf ? "Cannot change your own role" : "Toggle admin"}
                        className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {u.is_admin ? 'Revoke admin' : 'Make admin'}
                      </button>
                      <span className="text-gray-700">|</span>
                      <button
                        onClick={() => handleDelete(u.id, u.display_name)}
                        disabled={isSelf}
                        title={isSelf ? "Cannot delete yourself" : "Delete user"}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Messages ──────────────────────────────────────────────────────────────────

function MessagesPanel() {
  const [messages, setMessages] = useState<AdminMessage[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.listMessages()
      .then(setMessages)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <ErrorBox message={error} />
  if (loading) return <Loading />

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recent Messages ({messages.length})</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">From</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Original</th>
              <th className="px-4 py-3 font-medium">Translated</th>
              <th className="px-4 py-3 font-medium">Langs</th>
              <th className="px-4 py-3 font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {messages.map(m => (
              <tr key={m.id} className="bg-gray-900/50 hover:bg-gray-800 transition-colors">
                <td className="px-4 py-3 font-medium">{m.sender_name}</td>
                <td className="px-4 py-3 text-gray-400">{m.recipient_name}</td>
                <td className="px-4 py-3 max-w-xs truncate" title={m.original_text}>
                  {m.original_text}
                </td>
                <td className="px-4 py-3 max-w-xs truncate text-gray-400" title={m.translated_text}>
                  {m.translated_text}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {m.source_lang} → {m.target_lang}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(m.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Audit Log ────────────────────────────────────────────────────────────────

function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.listAudit()
      .then(setEntries)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <ErrorBox message={error} />
  if (loading) return <Loading />

  const actionColor = (action: string) => {
    if (action.includes('delete')) return 'text-red-400'
    if (action.includes('grant') || action.includes('revoke')) return 'text-yellow-400'
    if (action.includes('view')) return 'text-gray-400'
    return 'text-indigo-400'
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Admin Audit Log ({entries.length})</h2>
      <p className="text-gray-500 text-xs mb-4">Append-only record of all admin actions. Cannot be deleted.</p>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Admin</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target / Detail</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {entries.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-600">No audit entries yet.</td></tr>
            ) : entries.map(e => (
              <tr key={e.id} className="bg-gray-900/50 hover:bg-gray-800 transition-colors">
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-medium">{e.admin_name}</td>
                <td className={`px-4 py-3 font-mono text-xs font-semibold ${actionColor(e.action)}`}>
                  {e.action}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {e.detail || e.target_id || '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs font-mono">{e.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Shared ─────────────────────────────────────────────────────────────────────

function Loading() {
  return <p className="text-gray-500 text-sm">Loading...</p>
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-3">{message}</p>
  )
}
