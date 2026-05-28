import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AttachIcon, MicIcon, SendIcon, StickerIcon } from './icons'
import { StickerPicker } from './StickerPicker'
import { uploadFile, type Attachment } from '../api/uploads'

type Props = {
  onSend: (body: string, attachmentId?: string) => void
  /** Optional typing-indicator hook. Called with `true` on first keystroke,
   *  renewed every ~3 s while typing, called with `false` on idle / submit /
   *  empty / unmount. */
  onTyping?: (started: boolean) => void
}

type Pending = {
  file: File
  previewUrl?: string
  progress: number // 0..1
  attachment?: Attachment
  error?: string
}

const MIN_HEIGHT = 24
const MAX_HEIGHT = 160
const MAX_FILE_BYTES = 25 * 1024 * 1024

/**
 * Telegram-style composer:
 *   [ 📎  message …            😊 ]   [🎤 / ➤]
 *
 * Attach + emoji live INSIDE the pill; send/mic sits outside on the right.
 * A pending-attachment strip slides in above the input row when a file is
 * staged via the attach button or pasted with Ctrl+V.
 */
export function Composer({ onSend, onTyping }: Props) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [stickerOpen, setStickerOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Typing state machine — refs so they don't trigger re-renders.
  const typingStateRef = useRef<{ started: boolean; lastSent: number }>({
    started: false,
    lastSent: 0,
  })
  const typingStopTimerRef = useRef<number | null>(null)

  const emitTyping = (started: boolean) => {
    if (!onTyping) return
    const state = typingStateRef.current
    const now = Date.now()
    if (started) {
      if (!state.started || now - state.lastSent > 3000) {
        onTyping(true)
        state.started = true
        state.lastSent = now
      }
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current)
      }
      typingStopTimerRef.current = window.setTimeout(() => {
        if (!onTyping) return
        if (typingStateRef.current.started) {
          onTyping(false)
          typingStateRef.current.started = false
          typingStateRef.current.lastSent = Date.now()
        }
        typingStopTimerRef.current = null
      }, 5000)
    } else {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current)
        typingStopTimerRef.current = null
      }
      if (state.started) {
        onTyping(false)
        state.started = false
        state.lastSent = now
      }
    }
  }

  // Clear typing on unmount.
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current)
      }
      if (typingStateRef.current.started && onTyping) {
        onTyping(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Release the object URL when the staged file changes / clears.
  useEffect(() => {
    return () => {
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl)
    }
  }, [pending?.previewUrl])

  const trimmed = value.trim()
  const uploadDone = !!pending?.attachment
  const uploadInProgress = !!pending && !pending.attachment && !pending.error
  const canSend =
    (trimmed.length > 0 || uploadDone) && !uploadInProgress

  const startUpload = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setPending({
        file,
        progress: 0,
        error: 'File exceeds 25 MB limit.',
      })
      return
    }
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined
    setPending({ file, previewUrl, progress: 0 })
    uploadFile(file, (p) => {
      const ratio = p.total > 0 ? p.loaded / p.total : 0
      setPending((curr) => (curr ? { ...curr, progress: ratio } : curr))
    })
      .then((attachment) =>
        setPending((curr) => (curr ? { ...curr, attachment, progress: 1 } : curr)),
      )
      .catch((err: Error) =>
        setPending((curr) => (curr ? { ...curr, error: err.message } : curr)),
      )
  }

  const clearPending = () => setPending(null)

  const submit = () => {
    if (!canSend) return
    const id = pending?.attachment?.id
    onSend(trimmed, id)
    setValue('')
    clearPending()
    emitTyping(false)
    requestAnimationFrame(() => autosize(taRef.current))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (pending) return // one attachment at a time
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          startUpload(file)
          return
        }
      }
    }
  }

  const handlePickFile = () => {
    if (pending) return
    fileInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) startUpload(file)
  }

  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)
    el.style.height = next + 'px'
  }

  return (
    <div className="z-10 border-t border-neutral-200/70 bg-white/90 px-3 py-2 backdrop-blur-md">
      <AnimatePresence initial={false}>
        {stickerOpen && (
          <StickerPicker
            onClose={() => setStickerOpen(false)}
            onPick={(sticker) => {
              // Sticker = a message with the sticker's upload_id as the
              // attachment and no text. Sent immediately, picker stays open.
              onSend('', sticker.upload_id)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {pending && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className="mb-2"
          >
            <PendingChip pending={pending} onCancel={clearPending} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <div className="relative flex min-h-[44px] min-w-0 flex-1 items-end rounded-[22px] border border-neutral-200 bg-white shadow-sm transition-colors focus-within:border-cognigram-300">
          {/* Attach (left, inside) */}
          <button
            type="button"
            onClick={handlePickFile}
            disabled={!!pending}
            className="absolute bottom-1 left-1 flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Attach"
          >
            <AttachIcon className="h-[22px] w-[22px]" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelected}
          />

          <textarea
            ref={(el) => {
              taRef.current = el
              autosize(el)
            }}
            value={value}
            onChange={(e) => {
              const v = e.target.value
              setValue(v)
              autosize(e.currentTarget)
              emitTyping(v.trim().length > 0)
            }}
            onBlur={() => emitTyping(false)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder="Message"
            className="block w-full resize-none bg-transparent py-3 pl-12 pr-12 text-[16px] leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 sm:text-[15px]"
            style={{ maxHeight: MAX_HEIGHT }}
          />

          {/* Sticker (right, inside) — opens the picker. The standalone emoji
              picker has been folded into stickers, so this is the only face
              button on the right. */}
          <button
            type="button"
            onClick={() => setStickerOpen((v) => !v)}
            className={`absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              stickerOpen
                ? 'bg-cognigram-50 text-cognigram-600'
                : 'text-neutral-400 hover:bg-neutral-100 hover:text-cognigram-600'
            }`}
            aria-label="Stickers"
          >
            <StickerIcon className="h-[22px] w-[22px]" />
          </button>
        </div>

        {/* Send / Mic (outside, right) */}
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
                className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-cognigram-500 to-cognigram-700 text-white shadow-md hover:from-cognigram-400 hover:to-cognigram-600"
                aria-label="Send"
              >
                <SendIcon className="h-5 w-5" />
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
                className="absolute inset-0 flex items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600"
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

function PendingChip({
  pending,
  onCancel,
}: {
  pending: Pending
  onCancel: () => void
}) {
  const pct = Math.round(pending.progress * 100)
  const sizeKb = (pending.file.size / 1024).toFixed(0)
  const isImage = pending.file.type.startsWith('image/')

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-500">
        {isImage && pending.previewUrl ? (
          <img
            src={pending.previewUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <AttachIcon className="h-6 w-6" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-neutral-900">
          {pending.file.name}
        </div>
        <div className="text-[11.5px] text-neutral-500">
          {pending.error ? (
            <span className="text-cognigram-600">{pending.error}</span>
          ) : pending.attachment ? (
            <span className="text-emerald-600">Ready · {sizeKb} KB</span>
          ) : (
            <span>Uploading… {pct}% · {sizeKb} KB</span>
          )}
        </div>
        {!pending.attachment && !pending.error && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-cognigram-500 transition-[width] duration-100"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-cognigram-600"
        aria-label="Remove attachment"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l12 12M6 18 18 6" />
        </svg>
      </button>
    </div>
  )
}
