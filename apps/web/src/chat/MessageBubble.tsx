import { motion } from 'framer-motion'
import type { Message } from '../api/chat'
import type { Attachment } from '../api/uploads'
import { CheckIcon, DoubleCheckIcon } from './icons'
import { formatTime } from './helpers'

type Props = {
  msg: Message
  mine: boolean
  hasTail: boolean
  isFirstOfRun: boolean
  /** Demo-only — receipts aren't wired yet. */
  read?: boolean
}

export function MessageBubble({
  msg,
  mine,
  hasTail,
  read = false,
}: Props) {
  // All four corners rounded ~18px; the corner closest to the tail sharpens to 4px.
  const radius = mine
    ? hasTail
      ? '18px 18px 4px 18px'
      : '18px 18px 18px 18px'
    : hasTail
      ? '18px 18px 18px 4px'
      : '18px 18px 18px 18px'

  const timeText = formatTime(msg.created_at)
  const hasAttachment = !!msg.attachment
  const hasBody = msg.body.length > 0
  const isSticker = msg.attachment?.kind === 'sticker'

  // Sticker-only messages render without bubble chrome — no background, no
  // padding, no tail. Just the transparent image with a small floating
  // timestamp + check pill in the bottom corner.
  if (isSticker && !hasBody) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8, scale: 0.85 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
        className="relative inline-block"
      >
        <StickerMedia attachment={msg.attachment as Attachment} />
        <span
          className={`pointer-events-none absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[10.5px] text-white`}
        >
          <span>{timeText}</span>
          {mine &&
            (read ? (
              <DoubleCheckIcon className="h-3.5 w-3.5" />
            ) : (
              <CheckIcon className="h-3.5 w-3.5" />
            ))}
        </span>
      </motion.div>
    )
  }

  return (
    // Outer container: position-relative for the tail. NO overflow-hidden
    // here — the tail extends 5px outside the bubble and must not be clipped.
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-w-0"
    >
      {/* Inner bubble: clipped so attachment images round with the corners. */}
      <div
        className={`relative overflow-hidden text-[14.5px] leading-snug text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] ${
          mine ? 'bg-[#FFE2E8]' : 'bg-white'
        }`}
        style={{ borderRadius: radius }}
      >
        {hasAttachment && (
          <AttachmentBlock attachment={msg.attachment as Attachment} />
        )}

        {/* Text column. Right padding reserves a fixed slot for the absolute
            timestamp so wrapping text can never overlap it. */}
        {hasBody && (
          <div className="whitespace-pre-wrap break-words px-3 py-1.5 pr-[58px]">
            {msg.body}
          </div>
        )}

        {/* Timestamp + checks, floating bottom-right of the inner bubble. */}
        <span
          className={`pointer-events-none absolute bottom-1 right-2 flex items-center gap-0.5 text-[10.5px] ${
            hasAttachment && !hasBody
              ? 'rounded-full bg-black/45 px-1.5 py-0.5 text-white'
              : mine
                ? 'text-cognigram-700/80'
                : 'text-neutral-400'
          }`}
        >
          <span>{timeText}</span>
          {mine &&
            (read ? (
              <DoubleCheckIcon className="h-3.5 w-3.5 text-cognigram-600" />
            ) : (
              <CheckIcon className="h-3.5 w-3.5" />
            ))}
        </span>
      </div>

      {/* Tail lives OUTSIDE the clipped inner bubble so it can extend past
          the bubble's edge without being clipped by overflow-hidden. */}
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
              <path d="M0 0c3 0 6 3 6 6 0 3 2 6 6 6H0V0z" fill="currentColor" />
            ) : (
              <path d="M12 0c-3 0-6 3-6 6 0 3-2 6-6 6h12V0z" fill="currentColor" />
            )}
          </svg>
        </span>
      )}
    </motion.div>
  )
}

function StickerMedia({ attachment }: { attachment: Attachment }) {
  // Animated stickers (WebM) play inline silently in a loop. Static stickers
  // (PNG / WEBP / GIF) render as a plain transparent image.
  if (attachment.mime === 'video/webm') {
    return (
      <video
        src={attachment.url}
        autoPlay
        muted
        loop
        playsInline
        className="block h-auto max-h-[192px] w-auto max-w-[192px]"
      />
    )
  }
  return (
    <img
      src={attachment.url}
      alt={attachment.name}
      loading="lazy"
      draggable={false}
      className="block h-auto max-h-[192px] w-auto max-w-[192px]"
    />
  )
}

function AttachmentBlock({ attachment }: { attachment: Attachment }) {
  switch (attachment.kind) {
    case 'sticker':
      return (
        <div className="flex items-center justify-center bg-transparent py-2">
          <StickerMedia attachment={attachment} />
        </div>
      )
    case 'image':
      return (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            className="block max-h-[320px] w-full object-cover"
            draggable={false}
          />
        </a>
      )
    case 'video':
      return (
        <video
          src={attachment.url}
          controls
          preload="metadata"
          className="block max-h-[360px] w-full"
        />
      )
    case 'audio':
      return (
        <div className="px-3 pt-2">
          <audio src={attachment.url} controls className="w-full" />
        </div>
      )
    case 'file':
    default:
      return <FileCard attachment={attachment} />
  }
}

function FileCard({ attachment }: { attachment: Attachment }) {
  const sizeLabel = formatSize(attachment.size)
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="m-2 flex items-center gap-3 rounded-xl bg-neutral-100/80 px-3 py-2 transition-colors hover:bg-neutral-200/70"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-500 shadow-sm">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-neutral-900">
          {attachment.name}
        </div>
        <div className="text-[11.5px] text-neutral-500">{sizeLabel}</div>
      </div>
    </a>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
