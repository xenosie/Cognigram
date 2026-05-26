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
  email_verified: boolean
  totp_enabled: boolean
}

export type LoginResponse =
  | ({ status: 'authenticated' } & TokenPair)
  | { status: 'needs_email_verification' }
  | { status: 'needs_totp'; challenge_token: string; expires_in: number }

export type TotpSetupResponse = {
  secret: string
  otpauth_url: string
}

export const auth = {
  signup: (email: string, username: string, password: string) =>
    api<{ status: string; email: string }>('/auth/signup', {
      method: 'POST',
      body: { email, username, password },
    }),

  verifyEmail: (email: string, code: string) =>
    api<TokenPair>('/auth/verify-email', {
      method: 'POST',
      body: { email, code },
    }),

  resendVerification: (email: string) =>
    api<{ status: string }>('/auth/resend-verification', {
      method: 'POST',
      body: { email },
    }),

  login: (email: string, password: string) =>
    api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  loginTotp: (challenge_token: string, code: string) =>
    api<TokenPair>('/auth/login/totp', {
      method: 'POST',
      body: { challenge_token, code },
    }),

  me: () => api<PublicUser>('/auth/me', { auth: true }),

  logout: (refresh_token: string) =>
    api<{ status: string }>('/auth/logout', {
      method: 'POST',
      body: { refresh_token },
    }),

  totpSetup: () =>
    api<TotpSetupResponse>('/auth/2fa/setup', { method: 'POST', auth: true }),

  totpEnable: (code: string) =>
    api<{ status: string }>('/auth/2fa/enable', {
      method: 'POST',
      auth: true,
      body: { code },
    }),
}
