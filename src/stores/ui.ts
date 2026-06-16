import { create } from 'zustand'

/**
 * UI store. Theme is fixed to 宣纸白 (paper) — no switcher; only font-scale
 * remains user-adjustable. data-theme="paper" is set once in main.tsx.
 */
interface UiState {
  fontScale: number
  setFontScale: (scale: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  fontScale: 1,
  setFontScale: (fontScale) => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`
    set({ fontScale })
  },
}))
