import { create } from 'zustand'

const STORAGE_KEY = 'tt_dark_mode'
/** Bump this when a theme reset on update is needed. */
const THEME_VERSION_KEY = 'tt_theme_version'
const CURRENT_THEME_VERSION = '2'

function applyTheme(dark: boolean): void {
  if (dark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  try {
    localStorage.setItem(STORAGE_KEY, dark ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function readSavedTheme(): boolean {
  try {
    // On version mismatch (fresh install / update), clear old theme preference
    // so the OS preference is used instead of a stale saved value.
    const storedVersion = localStorage.getItem(THEME_VERSION_KEY)
    if (storedVersion !== CURRENT_THEME_VERSION) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(THEME_VERSION_KEY, CURRENT_THEME_VERSION)
    }

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) return saved === '1'
    // No saved preference: use OS preference (defaults to light on most systems)
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } catch {
    return false
  }
}

const initialDark = readSavedTheme()
applyTheme(initialDark)

interface ThemeState {
  dark: boolean
  toggle: () => void
  setDark: (dark: boolean) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  dark: initialDark,

  toggle: () => {
    const newDark = !get().dark
    set({ dark: newDark })
    applyTheme(newDark)
  },

  setDark: (dark) => {
    set({ dark })
    applyTheme(dark)
  },
}))
