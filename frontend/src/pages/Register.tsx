import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { LANGUAGES } from '../types'
import { useUILang } from '../context/UILangContext'

export default function Register() {
  const { login } = useAuth()
  const { T, lang, toggle } = useUILang()
  const [form, setForm] = useState({
    email: '',
    password: '',
    username: '',
    display_name: '',
    language_code: 'en',
    registration_key: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.register(form)
      login(res.token, res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <button onClick={toggle} className="fixed top-4 right-4 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded transition-colors">
        {lang === 'en' ? '日本語' : 'EN'}
      </button>
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-white text-center mb-1">free2talk</h1>
        <p className="text-gray-500 text-center mb-8 text-sm">{T.appTagline}</p>

        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-2xl p-8 space-y-5">
          <h2 className="text-xl font-semibold text-white">{T.createAccount}</h2>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.registrationKey}</label>
            <input
              type="password"
              value={form.registration_key}
              onChange={e => set('registration_key', e.target.value)}
              required
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder={T.inviteKeyPlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.displayName}</label>
            <input
              type="text"
              value={form.display_name}
              onChange={e => set('display_name', e.target.value)}
              required
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder={T.displayNamePlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.username}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 select-none">@</span>
              <input
                type="text"
                value={form.username}
                onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
                minLength={3}
                maxLength={20}
                className="w-full bg-gray-700 text-white rounded-lg pl-7 pr-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
                placeholder={T.usernamePlaceholder}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">{T.usernameHint}</p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.email}</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              required
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder={T.emailPlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.password}</label>
            <input
              type="password"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              required
              minLength={8}
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder={T.passwordPlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">{T.yourLanguage}</label>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => set('language_code', lang.code)}
                  className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                    form.language_code === lang.code
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {lang.flag} {lang.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition-colors"
          >
            {loading ? T.creatingAccount : T.createAccount}
          </button>

          <p className="text-gray-400 text-sm text-center">
            {T.alreadyHaveAccount}{' '}
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
              {T.signIn}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
