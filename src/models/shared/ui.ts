import { create } from 'zustand'

/**
 * UI store — global UI session state only.
 *
 * Theme is fixed to 宣纸白 (paper); only font-scale is user-adjustable.
 * data-theme="paper" is set once in main.tsx. Persisted data lives in SQLite.
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
