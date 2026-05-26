import { api } from './client'

export type Contact = {
  id: string
  email: string
  username: string | null
}

export const users = {
  list: (params?: { q?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.limit) qs.set('limit', String(params.limit))
    const tail = qs.toString() ? `?${qs}` : ''
    return api<Contact[]>(`/users${tail}`, { auth: true })
  },
}
