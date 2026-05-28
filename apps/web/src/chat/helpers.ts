import type { Message } from '../api/chat'

/* -------------------- avatar colour gradient -------------------- */

// Eight Telegram-style accents, all rotated into the red/pink family.
const PALETTE: Array<[string, string]> = [
  ['#FF6B6B', '#B91C1C'], // bright red
  ['#FF7F94', '#9E1B3D'], // pink → wine
  ['#F0808C', '#8C0E0E'], // salmon → deep red
  ['#E13B3B', '#6E0B0B'], // crimson
  ['#D43838', '#7A0F0F'], // brick
  ['#FFB29A', '#C0392B'], // peach → red
  ['#F472B6', '#831843'], // hot pink
  ['#F8B5A6', '#7F1D1D'], // blush
]

export function colorForId(id: string): [string, string] {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/* -------------------- name & initials -------------------- */

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  // strip separators, title-case
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ')
    .slice(0, 32) || email
}

/**
 * Order of preference for what to show next to an avatar:
 *  1. The user's profile display name (`name`)
 *  2. Their @username
 *  3. A title-cased name derived from their email local-part
 */
export function displayNameFor(input: {
  name?: string | null
  username?: string | null
  email: string
}): string {
  if (input.name && input.name.trim().length > 0) {
    return input.name.trim()
  }
  if (input.username && input.username.trim().length > 0) {
    return input.username
  }
  return displayNameFromEmail(input.email)
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/* -------------------- date / time -------------------- */

const ONE_DAY = 86_400_000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatChatListTime(ts: number | null): string {
  if (!ts) return ''
  const now = Date.now()
  const today = startOfDay(now)
  const that = startOfDay(ts)
  if (that === today) return formatTime(ts)
  if (today - that === ONE_DAY) return 'Yesterday'
  if (now - ts < 7 * ONE_DAY) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })
  }
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
  })
}

export function formatDateDivider(ts: number): string {
  const now = Date.now()
  const today = startOfDay(now)
  const that = startOfDay(ts)
  if (that === today) return 'Today'
  if (today - that === ONE_DAY) return 'Yesterday'
  if (now - ts < 365 * ONE_DAY) {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    })
  }
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/* -------------------- message grouping -------------------- */

export type GroupedItem =
  | { kind: 'divider'; key: string; label: string }
  | {
      kind: 'message'
      key: string
      msg: Message
      // Tail attaches to the LAST message of a same-author run within ~3 min
      hasTail: boolean
      // Avatar shows only for incoming messages on the last message in a run
      showAvatar: boolean
      // Top-of-group from same author gets more top spacing
      isFirstOfRun: boolean
    }

const RUN_WINDOW_MS = 3 * 60_000

export function groupMessages(messages: Message[]): GroupedItem[] {
  const out: GroupedItem[] = []
  let lastDayKey: string | null = null

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const next = messages[i + 1]
    const prev = messages[i - 1]

    const dayKey = String(startOfDay(m.created_at))
    if (dayKey !== lastDayKey) {
      out.push({
        kind: 'divider',
        key: `d-${dayKey}`,
        label: formatDateDivider(m.created_at),
      })
      lastDayKey = dayKey
    }

    const sameAuthorAsPrev =
      !!prev &&
      prev.sender_id === m.sender_id &&
      m.created_at - prev.created_at < RUN_WINDOW_MS &&
      startOfDay(prev.created_at) === startOfDay(m.created_at)

    const sameAuthorAsNext =
      !!next &&
      next.sender_id === m.sender_id &&
      next.created_at - m.created_at < RUN_WINDOW_MS &&
      startOfDay(next.created_at) === startOfDay(m.created_at)

    out.push({
      kind: 'message',
      key: m.id,
      msg: m,
      hasTail: !sameAuthorAsNext,
      showAvatar: !sameAuthorAsNext,
      isFirstOfRun: !sameAuthorAsPrev,
    })
  }
  return out
}
