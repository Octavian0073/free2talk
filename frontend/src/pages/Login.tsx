import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { useUILang } from '../context/UILangContext'

export default function Login() {
  const { login } = useAuth()
  const { T, lang, toggle } = useUILang()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.login({ email, password })
      login(res.token, res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
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
          <h2 className="text-xl font-semibold text-white">{T.signIn}</h2>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.email}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder={T.emailPlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">{T.password}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 transition-colors"
          >
            {loading ? T.signingIn : T.signIn}
          </button>

          <p className="text-gray-400 text-sm text-center">
            {T.noAccount}{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
              {T.register}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
