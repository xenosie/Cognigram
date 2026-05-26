import { useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AttachIcon, EmojiIcon, MicIcon, SendIcon } from './icons'

type Props = {
  onSend: (body: string) => void
}

/**
 * Telegram-style composer:
 *   [📎]  [ text input ……  😀 ]  [🎤 / ➤]
 *
 * The text input fills the row via an explicit `w-full` textarea; the emoji
 * button is absolutely positioned so it never competes for flex width (which
 * was collapsing the textarea to ~1 character wide).
 */
export function Composer({ onSend }: Props) {
  const [value, setValue] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const trimmed = value.trim()
  const canSend = trimmed.length > 0

  const submit = () => {
    if (!canSend) return
    onSend(trimmed)
    setValue('')
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto'
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  return (
    <div className="z-10 border-t border-neutral-200/70 bg-white/90 px-3 py-2.5 backdrop-blur-md">
      <div className="flex items-end gap-2">
        {/* Attach (left) */}
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
          aria-label="Attach"
        >
          <AttachIcon className="h-[22px] w-[22px]" />
        </button>

        {/* Input pill — emoji button is absolute so the textarea owns full width */}
        <div className="relative min-w-0 flex-1 rounded-3xl border border-neutral-200 bg-white shadow-sm transition-colors focus-within:border-keracross-300">
          <textarea
            ref={(el) => {
              taRef.current = el
              autosize(el)
            }}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              autosize(e.currentTarget)
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Write a message…"
            className="block max-h-[180px] w-full resize-none rounded-3xl bg-transparent py-2.5 pl-4 pr-12 text-[14.5px] leading-snug text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          <button
            type="button"
            className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
            aria-label="Emoji"
          >
            <EmojiIcon className="h-[22px] w-[22px]" />
          </button>
        </div>

        {/* Mic ↔ Send (far right) */}
        <div className="relative h-11 w-11 shrink-0">
          <AnimatePresence initial={false} mode="wait">
            {canSend ? (
              <motion.button
                key="send"
                type="button"
                onClick={submit}
                initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-keracross-500 to-keracross-700 text-white shadow-md hover:from-keracross-400 hover:to-keracross-600"
                aria-label="Send"
              >
                <SendIcon className="h-[20px] w-[20px]" />
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                type="button"
                initial={{ opacity: 0, rotate: 45, scale: 0.7 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: -45, scale: 0.7 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                className="absolute inset-0 flex items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
                aria-label="Record voice message"
              >
                <MicIcon className="h-[22px] w-[22px]" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
