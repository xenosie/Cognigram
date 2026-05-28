import { api } from './client'
import { useAuth } from '../store/auth'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type StickerPack = {
  id: string
  uname: string
  name: string
  owner_id: string
  sticker_count: number
  is_animated: boolean
  is_default: boolean
  is_installed: boolean
  is_owner: boolean
  created_at: number
}

export type Sticker = {
  id: string
  pack_id: string
  /** Pass this as `attachment_id` when sending a sticker as a message. */
  upload_id: string
  url: string
  mime: string
  width: number | null
  height: number | null
  emoji: string | null
}

export type PackWithStickers = {
  pack: StickerPack
  stickers: Sticker[]
}

export const stickers = {
  /** Installed + default packs, each pre-bundled with its sticker list. */
  list: () =>
    api<PackWithStickers[]>('/sticker-packs', { auth: true }),

  byUname: (uname: string) =>
    api<PackWithStickers>(
      `/sticker-packs/by-uname/${encodeURIComponent(uname)}`,
      { auth: true },
    ),

  create: (input: { uname: string; name: string }) =>
    api<StickerPack>('/sticker-packs', {
      method: 'POST',
      auth: true,
      body: input,
    }),

  install: (id: string) =>
    api<StickerPack>(`/sticker-packs/${id}/install`, {
      method: 'POST',
      auth: true,
    }),

  uninstall: (id: string) =>
    api<{ status: string }>(`/sticker-packs/${id}/uninstall`, {
      method: 'POST',
      auth: true,
    }),

  /** Upload a single sticker (PNG / WEBP / GIF / WebM up to 512 KB). */
  uploadSticker: async (
    packId: string,
    file: File,
    emoji?: string,
  ): Promise<Sticker> => {
    const token = useAuth.getState().accessToken
    if (!token) throw new Error('not authenticated')
    const fd = new FormData()
    fd.append('file', file, file.name)
    const qs = emoji ? `?emoji=${encodeURIComponent(emoji)}` : ''
    const res = await fetch(`${BASE}/sticker-packs/${packId}/stickers${qs}`, {
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
    return (await res.json()) as Sticker
  },
}
