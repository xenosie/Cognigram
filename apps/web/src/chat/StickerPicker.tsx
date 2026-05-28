import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { stickers, type PackWithStickers, type Sticker } from '../api/stickers'

type Props = {
  /** Called when the user picks a sticker — sends as a message attachment. */
  onPick: (sticker: Sticker) => void
  onClose: () => void
}

/**
 * Telegram-style sticker picker. Sits above the composer; horizontal pack tab
 * row at the top, sticker grid below. Lazy-loaded on first open.
 */
export function StickerPicker({ onPick, onClose }: Props) {
  const [packs, setPacks] = useState<PackWithStickers[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Fetch installed + default packs on first render.
  useEffect(() => {
    let cancelled = false
    stickers
      .list()
      .then((data) => {
        if (cancelled) return
        setPacks(data)
        setActiveIndex(0)
      })
      .catch(() => {
        if (!cancelled) setPacks([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Esc closes; click outside closes (but not the composer area below us).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        // Don't auto-close on every click — the composer textarea below us
        // is the most-tapped element. We only close on Escape or the chevron
        // button below.
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const active = packs?.[activeIndex]

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.18 }}
      className="mx-2 mb-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl"
    >
      {/* Pack tab row */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-100 px-2 py-2">
        {packs == null && (
          <span className="px-3 py-2 text-[12px] text-neutral-400">Loading…</span>
        )}
        {packs?.length === 0 && (
          <span className="px-3 py-2 text-[12px] text-neutral-400">
            No sticker packs installed yet.
          </span>
        )}
        {packs?.map((p, i) => {
          const thumb = p.stickers[0]
          return (
            <button
              key={p.pack.id}
              type="button"
              onClick={() => setActiveIndex(i)}
              title={`@${p.pack.uname} — ${p.pack.name}`}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                i === activeIndex
                  ? 'bg-cognigram-50 ring-1 ring-cognigram-300'
                  : 'hover:bg-neutral-100'
              }`}
            >
              {thumb ? (
                thumb.mime === 'video/webm' ? (
                  <video
                    src={thumb.url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-7 w-7 object-contain"
                  />
                ) : (
                  <img
                    src={thumb.url}
                    alt=""
                    className="h-7 w-7 object-contain"
                    draggable={false}
                  />
                )
              ) : (
                <span className="text-[14px] text-neutral-400">?</span>
              )}
            </button>
          )
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
          aria-label="Close stickers"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M6 18 18 6" />
          </svg>
        </button>
      </div>

      {/* Sticker grid for the active pack */}
      <div className="max-h-[260px] overflow-y-auto p-2">
        {active && active.stickers.length === 0 && (
          <p className="px-3 py-6 text-center text-[12.5px] text-neutral-400">
            This pack is empty.
          </p>
        )}
        {active && active.stickers.length > 0 && (
          <div className="grid grid-cols-5 gap-1">
            {active.stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s)}
                className="flex aspect-square items-center justify-center rounded-lg transition-colors hover:bg-neutral-100 active:scale-95"
              >
                {s.mime === 'video/webm' ? (
                  <video
                    src={s.url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <img
                    src={s.url}
                    alt=""
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
