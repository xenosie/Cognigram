import { api } from './client'
import type { Channel } from './channels'
import type { StickerPack } from './stickers'

export type UserHit = {
  id: string
  email: string
  username: string | null
  name: string | null
  picture: string | null
}

export type SearchResults = {
  users: UserHit[]
  channels: Channel[]
  sticker_packs: StickerPack[]
}

export const search = {
  query: (q: string) =>
    api<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { auth: true }),
}
