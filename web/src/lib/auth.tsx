import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { getToken, setToken as persistToken } from './api'

export type Role = 'member' | 'admin'

interface DecodedToken {
  userId: string
  role: Role
}

interface AuthContextValue {
  token: string | null
  userId: string | null
  role: Role | null
  isLoggedIn: boolean
  isAdmin: boolean
  setToken: (token: string | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Client-side only — for UI gating (show/hide nav items). The server enforces real authorization regardless of what this decodes. */
function decodeToken(token: string): DecodedToken | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(normalized)
    const parsed = JSON.parse(json) as { sub?: string; role?: Role }
    if (!parsed.sub || !parsed.role) return null
    return { userId: parsed.sub, role: parsed.role }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  const setToken = (next: string | null): void => {
    persistToken(next)
    setTokenState(next)
  }

  const decoded = useMemo(() => (token ? decodeToken(token) : null), [token])

  const value: AuthContextValue = {
    token,
    userId: decoded?.userId ?? null,
    role: decoded?.role ?? null,
    isLoggedIn: decoded !== null,
    isAdmin: decoded?.role === 'admin',
    setToken,
    logout: () => setToken(null),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
