import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Message, Participant } from '../api/chat'
import { MessageBubble } from './MessageBubble'
import { Avatar } from './Avatar'
import { groupMessages } from './helpers'
import { ChevronDownIcon } from './icons'
import { useAuth } from '../store/auth'

type Props = {
  messages: Message[]
  meId: string
  other: Participant
}

const NEAR_BOTTOM_PX = 80

export function MessageList({ messages, meId, other }: Props) {
  const me = useAuth((s) => s.user)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const stuckToBottomRef = useRef(true)

  const grouped = groupMessages(messages)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stuckToBottomRef.current = distFromBottom < NEAR_BOTTOM_PX
    setShowScrollDown(distFromBottom > 200)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stuckToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto py-3 pl-2 pr-3"
        style={{ scrollbarGutter: 'stable' }}
      >
        {/* Left-aligned column so messages hug the conversation's left edge */}
        <div className="flex w-full flex-col">
          {grouped.map((item) => {
            if (item.kind === 'divider') {
              return (
                <motion.div
                  key={item.key}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="my-3 flex items-center justify-center"
                >
                  <span className="rounded-full bg-black/45 px-3 py-1 text-[11.5px] font-medium text-white shadow-sm backdrop-blur">
                    {item.label}
                  </span>
                </motion.div>
              )
            }

            const mine = item.msg.sender_id === meId

            // Avatar shown beside EVERY message (Telegram-style on the left,
            // mine on the right). Compact 28px circles to keep the rail tight.
            const incomingAvatar = !mine && (
              <Avatar id={other.id} email={other.email} size={28} />
            )
            const outgoingAvatar = mine && me && (
              <Avatar id={me.id} email={me.email} size={28} />
            )

            return (
              <div
                key={item.key}
                className={`flex items-end gap-2 ${mine ? 'flex-row-reverse pl-0' : 'pl-0'} ${
                  item.isFirstOfRun ? 'mt-2' : 'mt-[2px]'
                }`}
              >
                <div className="w-7 shrink-0">
                  {mine ? outgoingAvatar : incomingAvatar}
                </div>
                <div className="min-w-0 max-w-[78%]">
                  <MessageBubble
                    msg={item.msg}
                    mine={mine}
                    hasTail={item.hasTail}
                    isFirstOfRun={item.isFirstOfRun}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {showScrollDown && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-keracross-600 shadow-lg ring-1 ring-black/5 hover:bg-keracross-50"
            aria-label="Scroll to latest"
          >
            <ChevronDownIcon className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
