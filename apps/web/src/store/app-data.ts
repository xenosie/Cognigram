import { create } from 'zustand'
import type { Channel } from '../api/channels'
import type { Chat } from '../api/chat'

/**
 * Cross-page cache for sidebar data. Lives outside any page component so
 * remounting Home (which happens whenever you switch between `/app` and
 * `/c/:uname` — they're sibling React Router matches) can't blank the
 * sidebar while the fresh `chat.list()` / `channels.list()` round-trips
 * resolve.
 *
 * Both lists are seeded once on first mount and then updated incrementally
 * via WS events + explicit user actions (open a chat, join a channel, etc).
 */

type Updater<T> = T | ((prev: T) => T)

function apply<T>(prev: T, value: Updater<T>): T {
  return typeof value === 'function' ? (value as (p: T) => T)(prev) : value
}

type AppDataState = {
  channels: Channel[]
  setChannels: (channels: Updater<Channel[]>) => void
  upsertChannel: (channel: Channel) => void
  findChannelByUname: (uname: string) => Channel | undefined

  chats: Chat[]
  /** Whether the chat list has been seeded from the server at least once.
   *  Lets us avoid showing "No chats yet" while the very first fetch is in
   *  flight — we render no placeholder until we know. */
  chatsLoaded: boolean
  setChats: (chats: Updater<Chat[]>) => void
  markChatsLoaded: () => void
}

export const useAppData = create<AppDataState>((set, get) => ({
  channels: [],
  setChannels: (value) => set((s) => ({ channels: apply(s.channels, value) })),
  upsertChannel: (channel) =>
    set((s) => {
      const idx = s.channels.findIndex((c) => c.id === channel.id)
      if (idx < 0) return { channels: [channel, ...s.channels] }
      const next = s.channels.slice()
      next[idx] = channel
      return { channels: next }
    }),
  findChannelByUname: (uname) => {
    const lc = uname.toLowerCase()
    return get().channels.find((c) => c.uname.toLowerCase() === lc)
  },

  chats: [],
  chatsLoaded: false,
  setChats: (value) => set((s) => ({ chats: apply(s.chats, value) })),
  markChatsLoaded: () => set({ chatsLoaded: true }),
}))
