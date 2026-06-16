import { create } from 'zustand'

export type Theme = 'paper' | 'ink' | 'dark'

interface UiState {
  theme: Theme
  fontScale: number
  setTheme: (theme: Theme) => void
  cycleTheme: () => void
  setFontScale: (scale: number) => void
}

const ORDER: Theme[] = ['paper', 'ink', 'dark']

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'paper',
  fontScale: 1,
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  cycleTheme: () => {
    const next = ORDER[(ORDER.indexOf(get().theme) + 1) % ORDER.length]
    applyTheme(next)
    set({ theme: next })
  },
  setFontScale: (fontScale) => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`
    set({ fontScale })
  },
}))
