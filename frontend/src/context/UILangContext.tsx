import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import t, { type UILang } from '../i18n'

interface UILangContextValue {
  lang: UILang
  T: typeof t['en']
  toggle: () => void
}

const UILangContext = createContext<UILangContextValue | null>(null)

export function UILangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<UILang>(
    () => (localStorage.getItem('ui_lang') as UILang) ?? 'en'
  )

  const toggle = () => {
    const next: UILang = lang === 'en' ? 'ja' : 'en'
    localStorage.setItem('ui_lang', next)
    setLang(next)
  }

  return (
    <UILangContext.Provider value={{ lang, T: t[lang], toggle }}>
      {children}
    </UILangContext.Provider>
  )
}

export function useUILang() {
  const ctx = useContext(UILangContext)
  if (!ctx) throw new Error('useUILang must be used within UILangProvider')
  return ctx
}
