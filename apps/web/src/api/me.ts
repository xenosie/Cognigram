import { api } from './client'
import type { PublicUser } from './auth'
import { useAuth } from '../store/auth'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type ProfilePatch = {
  display_name?: string
  username?: string
}

export const me = {
  update: (patch: ProfilePatch) =>
    api<PublicUser>('/auth/me', { method: 'PATCH', auth: true, body: patch }),

  checkHandle: (uname: string) =>
    api<{ available: boolean }>(
      `/handles/check?uname=${encodeURIComponent(uname)}`,
      { auth: true },
    ),

  /**
   * Avatar upload uses multipart, so we go via fetch directly (not the JSON
   * `api()` helper). Returns the updated `PublicUser` with the new picture URL.
   */
  uploadAvatar: async (file: File): Promise<PublicUser> => {
    const token = useAuth.getState().accessToken
    if (!token) throw new Error('not authenticated')
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await fetch(`${BASE}/auth/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    })
    if (!res.ok) {
      let message = `Upload failed (${res.status})`
      try {
        const data = await res.json()
        if (typeof data?.message === 'string') message = data.message
      } catch {
        // ignore
      }
      throw new Error(message)
    }
    return (await res.json()) as PublicUser
  },
}
