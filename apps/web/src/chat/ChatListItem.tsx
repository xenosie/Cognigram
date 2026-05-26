import { motion } from 'framer-motion'
import type { Chat } from '../api/chat'
import { Avatar } from './Avatar'
import { displayNameFor, formatChatListTime } from './helpers'

type Props = {
  chat: Chat
  meId: string | undefined
  active: boolean
  onClick: () => void
}

export function ChatListItem({ chat, meId, active, onClick }: Props) {
  const other =
    chat.participants.find((p) => p.id !== meId) ?? chat.participants[0]
  const name = other ? displayNameFor(other) : ''
  const time = formatChatListTime(chat.last_message_at)
  const preview =
    chat.last_message_preview?.trim() || 'No messages yet'

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className="relative flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left transition-colors hover:bg-white"
    >
      {/* Active indicator: thin red bar on the left, no bg tint */}
      {active && (
        <motion.span
          layoutId="chat-active-bar"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-gradient-to-b from-keracross-500 to-keracross-700"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}

      <Avatar id={other?.id ?? chat.id} email={other?.email ?? ''} size={52} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[15px] ${
              active
                ? 'font-semibold text-keracross-700'
                : 'font-semibold text-neutral-900'
            }`}
          >
            {name}
          </span>
          <span
            className={`shrink-0 text-[11px] ${
              active ? 'text-keracross-600' : 'text-neutral-400'
            }`}
          >
            {time}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-neutral-500">
          {preview}
        </div>
      </div>
    </motion.button>
  )
}
