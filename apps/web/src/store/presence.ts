import { create } from 'zustand'

/**
 * Online/offline state per user. Seeded from `Chat.other_online` on the
 * initial chat-list fetch, then kept fresh via WS `presence` events.
 *
 * Keyed by user_id (decimal string, same as `Participant.id`).
 */
type PresenceState = {
  online: Record<string, boolean>
  set: (userId: string, online: boolean) => void
  setMany: (entries: Array<[string, boolean]>) => void
}

export const usePresence = create<PresenceState>((set) => ({
  online: {},
  set: (userId, online) =>
    set((s) => ({ online: { ...s.online, [userId]: online } })),
  setMany: (entries) =>
    set((s) => {
      const next = { ...s.online }
      for (const [uid, on] of entries) next[uid] = on
      return { online: next }
    }),
}))
