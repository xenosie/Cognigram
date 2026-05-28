import { api } from './client'

export type TokenPair = {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
}

export type PublicUser = {
  id: string
  email: string
  username: string | null
  name: string | null
  picture: string | null
}

export type GoogleAuthResponse = {
  user: PublicUser
  tokens: TokenPair
  needs_username: boolean
}

export const auth = {
  /** Exchange a Google Identity Services `credential` (id_token) for our token pair. */
  googleLogin: (id_token: string) =>
    api<GoogleAuthResponse>('/auth/google', {
      method: 'POST',
      body: { id_token },
    }),

  /** One-time username pick after first Google sign-in. */
  setUsername: (username: string) =>
    api<PublicUser>('/auth/username', {
      method: 'POST',
      auth: true,
      body: { username },
    }),

  me: () => api<PublicUser>('/auth/me', { auth: true }),

  logout: (refresh_token: string) =>
    api<{ status: string }>('/auth/logout', {
      method: 'POST',
      body: { refresh_token },
    }),
}
