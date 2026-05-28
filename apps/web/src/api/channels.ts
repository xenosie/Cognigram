import { api } from './client'
import type { Message, Participant } from './chat'
import { useAuth } from '../store/auth'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type ChannelKind = 'group' | 'channel'

export type Channel = {
  id: string
  kind: ChannelKind
  uname: string
  name: string
  description: string | null
  avatar: string | null
  owner_id: string
  member_count: number
  is_member: boolean
  is_owner: boolean
  /** Unread messages for the viewer; capped at 100, UI renders 99+. */
  unread_count: number
  created_at: number
}

export type ChannelMessageList = {
  messages: Message[]
  senders: Record<string, Participant>
}

export type CreateChannelInput = {
  kind: ChannelKind
  uname: string
  name: string
  description?: string
}

export type PatchChannelInput = {
  name?: string
  uname?: string
  description?: string
}

export const channels = {
  list: () => api<Channel[]>('/channels', { auth: true }),

  create: (input: CreateChannelInput) =>
    api<Channel>('/channels', { method: 'POST', auth: true, body: input }),

  get: (id: string) => api<Channel>(`/channels/${id}`, { auth: true }),

  byUname: (uname: string) =>
    api<Channel>(`/channels/by-uname/${encodeURIComponent(uname)}`, { auth: true }),

  patch: (id: string, patch: PatchChannelInput) =>
    api<Channel>(`/channels/${id}`, { method: 'PATCH', auth: true, body: patch }),

  join: (id: string) =>
    api<Channel>(`/channels/${id}/join`, { method: 'POST', auth: true }),

  leave: (id: string) =>
    api<{ status: string }>(`/channels/${id}/leave`, {
      method: 'POST',
      auth: true,
    }),

  history: (
    id: string,
    params?: { limit?: number; before?: string },
  ): Promise<ChannelMessageList> => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.before) qs.set('before', params.before)
    const q = qs.toString() ? `?${qs}` : ''
    return api<ChannelMessageList>(`/channels/${id}/messages${q}`, { auth: true })
  },

  send: (id: string, body: string, attachmentId?: string) =>
    api<Message>(`/channels/${id}/messages`, {
      method: 'POST',
      auth: true,
      body: { body, attachment_id: attachmentId ?? null },
    }),

  uploadAvatar: async (id: string, file: File): Promise<Channel> => {
    const token = useAuth.getState().accessToken
    if (!token) throw new Error('not authenticated')
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await fetch(`${BASE}/channels/${id}/avatar`, {
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
    return (await res.json()) as Channel
  },
}
