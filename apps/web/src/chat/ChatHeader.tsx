import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Participant } from '../api/chat'
import { Avatar } from './Avatar'
import { MenuIcon, PaletteIcon, SearchIcon } from './icons'
import { displayNameFor } from './helpers'
import { WallpaperPicker } from './WallpaperPicker'

type Props = {
  other: Participant
}

export function ChatHeader({ other }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const name = displayNameFor(other)
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="z-10 flex h-[64px] items-center gap-3 border-b border-neutral-200/70 bg-white/90 px-4 backdrop-blur-md"
    >
      <div className="relative">
        <Avatar id={other.id} email={other.email} size={40} />
        {/* presence dot — placeholder until we wire real presence */}
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-keracross-500"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-neutral-900">
          {name}
        </div>
        <div className="flex items-center gap-1 text-[12px] text-neutral-500">
          <span className="text-keracross-600">online</span>
          {other.username && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate text-neutral-500">@{other.username}</span>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
        aria-label="Search in chat"
      >
        <SearchIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
        aria-label="Change wallpaper"
        title="Change wallpaper"
      >
        <PaletteIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
        aria-label="More"
      >
        <MenuIcon className="h-5 w-5" />
      </button>
      <WallpaperPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </motion.header>
  )
}
