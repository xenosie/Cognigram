import { api } from './client'
import type { Attachment } from './uploads'

export type Participant = {
  id: string
  email: string
  username: string | null
  name: string | null
  picture: string | null
}

export type Chat = {
  id: string
  participants: Participant[]
  last_message_at: number | null
  last_message_preview: string | null
  /** Unread count for the viewer; capped at 100 server-side (UI renders 99+). */
  unread_count: number
  /** Highest message id the OTHER participant has read. Numeric stringified. */
  other_last_read: string
  /** Whether the other participant currently has a live socket. */
  other_online: boolean
}

export type Message = {
  id: string
  chat_id: string
  sender_id: string
  body: string
  attachment: Attachment | null
  created_at: number
}

export const chat = {
  list: () => api<Chat[]>('/chats', { auth: true }),

  /** Open a chat with someone by their email OR username. */
  open: (handle: string) =>
    api<Chat>('/chats', { method: 'POST', auth: true, body: { handle } }),

  history: (chatId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.before) qs.set('before', params.before)
    const q = qs.toString() ? `?${qs}` : ''
    return api<Message[]>(`/chats/${chatId}/messages${q}`, { auth: true })
  },

  send: (chatId: string, body: string, attachmentId?: string) =>
    api<Message>(`/chats/${chatId}/messages`, {
      method: 'POST',
      auth: true,
      body: { body, attachment_id: attachmentId ?? null },
    }),
}
