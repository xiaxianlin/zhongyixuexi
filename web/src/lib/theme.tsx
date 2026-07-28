import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** 「青瓷诊脉」只有明暗两档——未手动选过时跟随系统偏好，选过之后记住选择。 */
export type Theme = 'light' | 'dark'

const THEME_KEY = 'zyxx_theme'
const THEME_LABEL: Record<Theme, string> = { light: '明', dark: '暗' }

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function readTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY)
  if (raw === 'light' || raw === 'dark') return raw
  return systemPrefersDark() ? 'dark' : 'light'
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
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = (): void => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  return (
    <ThemeContext.Provider value={{ theme, label: THEME_LABEL[theme], toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
