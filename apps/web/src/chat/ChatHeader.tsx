import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Participant } from '../api/chat'
import { Avatar } from './Avatar'
import { MenuIcon, PaletteIcon, SearchIcon } from './icons'
import { TypingDots } from './TypingDots'
import { displayNameFor } from './helpers'
import { WallpaperPicker } from './WallpaperPicker'
import { useUi } from '../store/ui'
import { useTyping, typingKey } from '../store/typing'
import { usePresence } from '../store/presence'

type Props = {
  other: Participant
  chatId: string
}

export function ChatHeader({ other, chatId }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  // Subscribe to raw map so we re-render when typing state changes; the
  // selector function returns the typed users list (which is cheap to derive).
  const typing = useTyping((s) => s.raw[typingKey('dm', chatId)])
  const isTyping =
    !!typing && Object.values(typing).some((e) => e.exp > Date.now())
  const isOnline = usePresence((s) => s.online[other.id] ?? false)
  const name = displayNameFor(other)
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="z-10 flex h-[64px] items-center gap-2 border-b border-neutral-200/70 bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4"
    >
      {/* Hamburger — opens the drawer; mobile only. */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 md:hidden"
        aria-label="Open sidebar"
      >
        <MenuIcon className="h-5 w-5" />
      </button>
      <div className="relative">
        <Avatar
          id={other.id}
          email={other.email}
          name={other.name}
          picture={other.picture}
          size={40}
        />
        {/* Presence dot — green when the other side has a live socket,
            grey otherwise. Updated by WS `presence` events. */}
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
            isOnline ? 'bg-emerald-500' : 'bg-neutral-300'
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-neutral-900">
          {name}
        </div>
        <div className="flex items-center gap-1 text-[12px] text-neutral-500">
          {isTyping ? (
            <span className="flex items-center gap-1.5 truncate text-cognigram-600">
              <span className="truncate">{name} is typing</span>
              <TypingDots />
            </span>
          ) : (
            <>
              <span
                className={
                  isOnline ? 'text-emerald-600' : 'text-neutral-400'
                }
              >
                {isOnline ? 'online' : 'offline'}
              </span>
              {other.username && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate text-neutral-500">
                    @{other.username}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        className="hidden h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 sm:flex"
        aria-label="Search in chat"
      >
        <SearchIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600"
        aria-label="Change wallpaper"
        title="Change wallpaper"
      >
        <PaletteIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="hidden h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 sm:flex"
        aria-label="More"
      >
        <MenuIcon className="h-5 w-5" />
      </button>
      <WallpaperPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </motion.header>
  )
}
