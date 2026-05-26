import { motion } from 'framer-motion'
import type { Message } from '../api/chat'
import { CheckIcon, DoubleCheckIcon } from './icons'
import { formatTime } from './helpers'

type Props = {
  msg: Message
  mine: boolean
  hasTail: boolean
  isFirstOfRun: boolean
  // For demo purposes; not wired to real receipts yet.
  read?: boolean
}

export function MessageBubble({
  msg,
  mine,
  hasTail,
  isFirstOfRun,
  read = false,
}: Props) {
  // Border radius corners: Telegram bubbles round all corners ~16px,
  // but the tail corner (bottom-near-tail) is sharpened to 4px.
  const radius = mine
    ? hasTail
      ? '18px 18px 4px 18px'
      : '18px 18px 18px 18px'
    : hasTail
      ? '18px 18px 18px 4px'
      : '18px 18px 18px 18px'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${mine ? 'justify-end' : 'justify-start'} ${
        isFirstOfRun ? 'mt-2' : 'mt-[2px]'
      }`}
    >
      <div
        className={`relative max-w-[68%] px-3 py-1.5 text-[14.5px] leading-snug text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] ${
          mine ? 'bg-[#FFE2E8]' : 'bg-white'
        }`}
        style={{ borderRadius: radius }}
      >
        <div className="whitespace-pre-wrap break-words pr-[58px]">
          {msg.body}
        </div>
        <div
          className={`pointer-events-none absolute bottom-1 right-2 flex items-center gap-0.5 text-[10.5px] ${
            mine ? 'text-keracross-700/80' : 'text-neutral-400'
          }`}
        >
          <span>{formatTime(msg.created_at)}</span>
          {mine &&
            (read ? (
              <DoubleCheckIcon className="h-3.5 w-3.5" />
            ) : (
              <CheckIcon className="h-3.5 w-3.5" />
            ))}
        </div>

        {hasTail && (
          <span
            aria-hidden
            className={`absolute bottom-0 ${
              mine ? '-right-[5px]' : '-left-[5px]'
            } h-3 w-3`}
          >
            <svg
              viewBox="0 0 12 12"
              className="h-full w-full"
              style={{ color: mine ? '#FFE2E8' : '#ffffff' }}
            >
              {mine ? (
                <path
                  d="M0 0c3 0 6 3 6 6 0 3 2 6 6 6H0V0z"
                  fill="currentColor"
                />
              ) : (
                <path
                  d="M12 0c-3 0-6 3-6 6 0 3-2 6-6 6h12V0z"
                  fill="currentColor"
                />
              )}
            </svg>
          </span>
        )}
      </div>
    </motion.div>
  )
}
