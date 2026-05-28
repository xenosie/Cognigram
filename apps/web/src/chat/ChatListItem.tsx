import { motion } from 'framer-motion'
import type { Chat } from '../api/chat'
import { Avatar } from './Avatar'
import { TypingDots } from './TypingDots'
import { displayNameFor, formatChatListTime } from './helpers'
import { useTyping, typingKey } from '../store/typing'
import { usePresence } from '../store/presence'

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

  // Is the other side typing in this chat right now?
  const typingBucket = useTyping((s) => s.raw[typingKey('dm', chat.id)])
  const typingName = typingBucket
    ? Object.entries(typingBucket)
        .filter(([uid, e]) => uid !== meId && e.exp > Date.now())
        .map(([, e]) => e.name)[0]
    : undefined
  // Green dot when the other participant has a live socket.
  const isOnline = usePresence((s) =>
    other ? s.online[other.id] ?? false : false,
  )

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
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-gradient-to-b from-cognigram-500 to-cognigram-700"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}

      <div className="relative shrink-0">
        <Avatar
          id={other?.id ?? chat.id}
          email={other?.email ?? ''}
          name={other?.name}
          picture={other?.picture}
          size={52}
        />
        {isOnline && (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[15px] ${
              active
                ? 'font-semibold text-cognigram-700'
                : 'font-semibold text-neutral-900'
            }`}
          >
            {name}
          </span>
          <span
            className={`shrink-0 text-[11px] ${
              active ? 'text-cognigram-600' : 'text-neutral-400'
            }`}
          >
            {time}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 truncate text-[13px]">
          <div className="min-w-0 flex-1 truncate">
            {typingName ? (
              <span className="flex min-w-0 items-center gap-1.5 truncate text-cognigram-600">
                <span className="truncate">{typingName} is typing</span>
                <TypingDots />
              </span>
            ) : (
              <span className="truncate text-neutral-500">{preview}</span>
            )}
          </div>
          {chat.unread_count > 0 && (
            <span
              aria-label={`${chat.unread_count} unread`}
              className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-cognigram-600 px-1.5 text-[10.5px] font-semibold leading-none text-white shadow-sm"
            >
              {chat.unread_count >= 100 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
