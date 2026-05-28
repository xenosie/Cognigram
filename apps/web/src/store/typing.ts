import { create } from 'zustand'
import type { TypingTarget } from '../lib/ws'

/**
 * Per-target typing-indicator state. Server is stateless — clients hold the
 * map and expire entries on a timeout if no renewal arrives.
 *
 * Key shape: `"${target_kind}:${target_id}"`. Inner map is user_id →
 * { name, expiresAt(ms) }. Sweeping happens lazily on each read.
 */

const RENEWAL_WINDOW_MS = 6000

type Entry = { name: string; exp: number }
type Inner = Record<string, Entry>

type TypingState = {
  raw: Record<string, Inner>
  /** Mark `userId` as typing in `target`. `started=false` removes them. */
  set: (target: string, userId: string, name: string, started: boolean) => void
  /** Return live typers as [userId, name][], lazily sweeping expired ones. */
  typingFor: (target: string) => Array<{ id: string; name: string }>
  clear: () => void
}

function targetKey(kind: TypingTarget, id: string): string {
  return `${kind}:${id}`
}

export const useTyping = create<TypingState>((set, get) => ({
  raw: {},
  set: (target, userId, name, started) => {
    set((s) => {
      const next = { ...s.raw }
      const bucket = { ...(next[target] ?? {}) }
      if (started) {
        bucket[userId] = { name, exp: Date.now() + RENEWAL_WINDOW_MS }
      } else {
        delete bucket[userId]
      }
      if (Object.keys(bucket).length === 0) {
        delete next[target]
      } else {
        next[target] = bucket
      }
      return { raw: next }
    })
  },
  typingFor: (target) => {
    const bucket = get().raw[target]
    if (!bucket) return []
    const now = Date.now()
    const live: Array<{ id: string; name: string }> = []
    let needsPrune = false
    for (const [uid, entry] of Object.entries(bucket)) {
      if (entry.exp > now) live.push({ id: uid, name: entry.name })
      else needsPrune = true
    }
    if (needsPrune) {
      queueMicrotask(() => {
        set((s) => {
          const stillBucket = s.raw[target]
          if (!stillBucket) return s
          const now2 = Date.now()
          const next: Inner = {}
          for (const [uid, entry] of Object.entries(stillBucket)) {
            if (entry.exp > now2) next[uid] = entry
          }
          if (Object.keys(next).length === 0) {
            const { [target]: _, ...rest } = s.raw
            return { raw: rest }
          }
          return { raw: { ...s.raw, [target]: next } }
        })
      })
    }
    return live
  },
  clear: () => set({ raw: {} }),
}))

export function typingKey(kind: TypingTarget, id: string): string {
  return targetKey(kind, id)
}
