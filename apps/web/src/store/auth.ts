import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PublicUser } from '../api/auth'

type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  user: PublicUser | null

  setTokens: (access: string, refresh: string, expiresInSecs: number) => void
  setUser: (u: PublicUser | null) => void
  clear: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,

      setTokens: (access, refresh, expiresInSecs) =>
        set({
          accessToken: access,
          refreshToken: refresh,
          expiresAt: Date.now() + expiresInSecs * 1000,
        }),
      setUser: (user) => set({ user }),
      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          user: null,
        }),
    }),
    {
      name: 'keracross-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
      }),
    },
  ),
)
