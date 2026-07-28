import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Same three themes as the desktop app's ui.ts (paper/ink/dark), applied via document.documentElement.dataset.theme. */
export type Theme = 'paper' | 'ink' | 'dark'

const THEME_KEY = 'zyxx_theme'
const THEME_ORDER: Theme[] = ['paper', 'ink', 'dark']
const THEME_LABEL: Record<Theme, string> = { paper: '暖纸', ink: '水墨', dark: '夜间' }

function readTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY)
  return raw === 'ink' || raw === 'dark' ? raw : 'paper'
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/** Call once before first paint (main.tsx) to avoid a flash of the default theme. */
export function initTheme(): void {
  applyTheme(readTheme())
}

interface ThemeContextValue {
  theme: Theme
  label: string
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const cycleTheme = (): void => {
    setTheme((prev) => THEME_ORDER[(THEME_ORDER.indexOf(prev) + 1) % THEME_ORDER.length]!)
  }

  return (
    <ThemeContext.Provider value={{ theme, label: THEME_LABEL[theme], cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
