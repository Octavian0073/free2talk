import { Link } from 'react-router-dom'
import { useUILang } from '../context/UILangContext'

export default function Landing() {
  const { T, lang, toggle } = useUILang()

  return (
    <div className="min-h-dvh bg-gray-950 text-white flex flex-col">

      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800/60">
        <span className="text-lg font-bold tracking-tight text-white">free2talk</span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded transition-colors"
          >
            {lang === 'en' ? '日本語' : 'EN'}
          </button>
          <Link
            to="/login"
            className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
          >
            {T.signIn}
          </Link>
          <Link
            to="/register"
            className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {T.getStarted}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 gap-8">
        <div className="max-w-2xl space-y-5">
          <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-medium px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Live captions · Auto-translation · WebRTC video
          </div>

          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight">
            Talk freely.<br />
            <span className="text-indigo-400">In any language.</span>
          </h1>

          <p className="text-gray-400 text-lg leading-relaxed max-w-xl mx-auto">
            Video calls and chat with real-time speech transcription and translation.
            Speak your language — your message arrives in theirs.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              to="/register"
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3 rounded-xl transition-colors text-sm"
            >
              Get started for free →
            </Link>
            <Link
              to="/login"
              className="w-full sm:w-auto bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white font-medium px-8 py-3 rounded-xl transition-colors text-sm"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl w-full mt-4">
          <FeatureCard
            icon="🎙️"
            title="Live Captions"
            description="Your speech is transcribed and translated in real time. Powered by Whisper + NLLB-200."
          />
          <FeatureCard
            icon="💬"
            title="Translated Chat"
            description="Send a message in English, your friend reads it in Romanian or Japanese — instantly."
          />
          <FeatureCard
            icon="🎥"
            title="Video Calls"
            description="Peer-to-peer WebRTC video. No relay server required on the same network."
          />
        </div>

        {/* Languages */}
        <div className="flex items-center gap-6 text-sm text-gray-500 mt-2">
          <span className="text-gray-700 text-xs uppercase tracking-widest font-medium">Supported</span>
          <span>🇬🇧 English</span>
          <span>🇷🇴 Romanian</span>
          <span>🇯🇵 Japanese</span>
        </div>
      </main>

      <footer className="text-center text-xs text-gray-700 py-6 border-t border-gray-800/60">
        free2talk — open source · self-hosted · private
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left space-y-2">
      <div className="text-2xl">{icon}</div>
      <p className="font-semibold text-sm text-white">{title}</p>
      <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
    </div>
  )
}
