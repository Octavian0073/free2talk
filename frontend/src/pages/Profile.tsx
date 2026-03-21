import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LANGUAGES } from '../types'
import { api } from '../api/client'

export default function Profile() {
  const { user, updateUser } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [languageCode, setLanguageCode] = useState(user?.language_code ?? 'en')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (!password) {
      setError('Enter your current password to save changes.')
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateProfile({ display_name: displayName, email, language_code: languageCode, password })
      updateUser(updated)
      setPassword('')
      setSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-gray-900 text-white flex flex-col">

      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-4 border-b border-gray-800">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white p-2 rounded-lg transition-colors -ml-1"
          title="Back to chat"
        >
          <BackIcon />
        </button>
        <h1 className="text-base font-semibold">Profile</h1>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-md">

          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 mb-8">
            <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-3xl font-bold select-none">
              {user?.display_name?.[0]?.toUpperCase()}
            </div>
            <p className="text-gray-400 text-sm">@{user?.username}</p>
          </div>

          <form onSubmit={handleSave} className="space-y-5">

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Language</label>
              <div className="flex gap-2">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setLanguageCode(lang.code)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                      languageCode === lang.code
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                    }`}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-gray-800">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Current password <span className="text-gray-600">(required to save changes)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-600"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-xl px-4 py-3">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-green-400 bg-green-950 border border-green-800 rounded-xl px-4 py-3">
                Profile updated successfully.
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors text-sm"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}

function BackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}
