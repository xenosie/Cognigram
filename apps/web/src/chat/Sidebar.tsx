import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { Chat } from '../api/chat'
import type { Contact } from '../api/users'
import { channels, type Channel, type ChannelKind } from '../api/channels'
import { stickers, type StickerPack } from '../api/stickers'
import { search as searchApi, type UserHit } from '../api/search'
import { ChatListItem } from './ChatListItem'
import { CreateChannel } from './CreateChannel'
import { TypingDots } from './TypingDots'
import { useTyping, typingKey } from '../store/typing'
import {
  LogoutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from './icons'
import { Avatar } from './Avatar'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { useAppData } from '../store/app-data'
import { displayNameFor } from './helpers'

type Props = {
  chats: Chat[]
  meId: string | undefined
  activeId: string | null
  onSelect: (id: string) => void
  onStartNew: (email: string) => Promise<void>
  onLogout: () => void
  error?: string | null
}

export function Sidebar({
  chats,
  meId,
  activeId,
  onSelect,
  onStartNew,
  onLogout,
  error,
}: Props) {
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const closeSidebar = useUi((s) => s.closeSidebar)
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUi((s) => s.toggleSidebarCollapsed)
  const [search, setSearch] = useState('')
  const [composing, setComposing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [composeMenuOpen, setComposeMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState<ChannelKind | null>(null)
  const [foundUsers, setFoundUsers] = useState<UserHit[]>([])
  const [foundChannels, setFoundChannels] = useState<Channel[]>([])
  const [foundPacks, setFoundPacks] = useState<StickerPack[]>([])
  const [installingPackId, setInstallingPackId] = useState<string | null>(null)
  // Joined channels live in the shared app-data store so ChannelView can
  // read them synchronously when the user clicks a sidebar row.
  const joinedChannels = useAppData((s) => s.channels)
  const setStoreChannels = useAppData((s) => s.setChannels)
  const upsertChannel = useAppData((s) => s.upsertChannel)
  const [startingContactId, setStartingContactId] = useState<string | null>(null)
  const newInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const composeMenuRef = useRef<HTMLDivElement | null>(null)

  // Search bar hits the unified /search endpoint — returns users + channels.
  useEffect(() => {
    const q = search.trim()
    if (!q) {
      setFoundUsers([])
      setFoundChannels([])
      setFoundPacks([])
      return
    }
    const id = window.setTimeout(() => {
      searchApi
        .query(q)
        .then((r) => {
          setFoundUsers(r.users)
          setFoundChannels(r.channels)
          setFoundPacks(r.sticker_packs)
        })
        .catch(() => {
          setFoundUsers([])
          setFoundChannels([])
          setFoundPacks([])
        })
    }, 220)
    return () => clearTimeout(id)
  }, [search])

  // Refresh the joined-channels list into the shared store. Run once on
  // mount + every time the create-channel modal closes (so freshly-made
  // packs/groups appear). Do NOT clear the store on errors — a one-off
  // network blip would otherwise wipe the sidebar.
  useEffect(() => {
    let cancelled = false
    channels
      .list()
      .then((cs) => {
        if (!cancelled) setStoreChannels(cs)
      })
      .catch(() => {
        /* keep whatever the store already has */
      })
    return () => {
      cancelled = true
    }
  }, [createOpen, setStoreChannels])

  // Hide users from search results that already have an open chat.
  const chatPartnerIds = useMemo(() => {
    const set = new Set<string>()
    for (const c of chats) {
      for (const p of c.participants) if (p.id !== meId) set.add(p.id)
    }
    return set
  }, [chats, meId])

  const filteredUsers = useMemo(
    () => foundUsers.filter((c) => !chatPartnerIds.has(c.id)),
    [foundUsers, chatPartnerIds],
  )

  const searching = search.trim().length > 0

  const startWithContact = async (contact: Contact | UserHit) => {
    setStartingContactId(contact.id)
    try {
      // Prefer username (canonical handle); fall back to email
      await onStartNew(contact.username ?? contact.email)
      closeSidebar()
    } catch {
      // surfaced via the `error` prop already
    } finally {
      setStartingContactId(null)
    }
  }

  const goToChannel = (channel: Channel) => {
    // Cache the channel into shared state BEFORE navigating so ChannelView
    // has its header data on the first paint — no blank flash while we
    // re-fetch over the network.
    upsertChannel(channel)
    closeSidebar()
    navigate(`/c/${channel.uname}`)
  }

  const installPack = async (pack: StickerPack) => {
    setInstallingPackId(pack.id)
    try {
      await stickers.install(pack.id)
      setFoundPacks((prev) =>
        prev.map((p) => (p.id === pack.id ? { ...p, is_installed: true } : p)),
      )
    } catch {
      // surfaced inline; nothing to do
    } finally {
      setInstallingPackId(null)
    }
  }

  useEffect(() => {
    if (composing) newInputRef.current?.focus()
  }, [composing])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!composeMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (
        composeMenuRef.current &&
        !composeMenuRef.current.contains(e.target as Node)
      ) {
        setComposeMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComposeMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [composeMenuOpen])

  const filtered = chats.filter((c) => {
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    return c.participants.some(
      (p) =>
        p.email.toLowerCase().includes(term) ||
        (p.username ?? '').toLowerCase().includes(term),
    )
  })

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail.trim()) return
    setBusy(true)
    try {
      await onStartNew(newEmail.trim().toLowerCase())
      setNewEmail('')
      setComposing(false)
      closeSidebar()
    } finally {
      setBusy(false)
    }
  }

  const handleSelect = (id: string) => {
    closeSidebar()
    onSelect(id)
    // If we're currently parked on /c/:uname, leave it so Home renders the
    // DM view rather than the channel view.
    if (window.location.pathname.startsWith('/c/')) {
      navigate('/app')
    }
  }

  // Desktop-only collapsed mode renders a 72px-wide column with just
  // avatars — clicking one opens its chat. Mobile drawer ignores collapse.
  if (sidebarCollapsed) {
    return (
      <CollapsedSidebar
        chats={chats}
        meId={meId}
        activeId={activeId}
        onSelectChat={handleSelect}
        joinedChannels={joinedChannels}
        onSelectChannel={goToChannel}
        onExpand={toggleSidebarCollapsed}
        onOpenCreate={(kind) => setCreateOpen(kind)}
        createOpen={createOpen}
        onCreateClose={() => setCreateOpen(null)}
      />
    )
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-[88vw] max-w-[340px] flex-col border-r border-neutral-200 bg-white shadow-xl transition-transform duration-200 md:relative md:w-[340px] md:shrink-0 md:translate-x-0 md:shadow-none ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <header
        className="relative flex h-[64px] items-center gap-2 border-b border-neutral-200 px-3"
        style={{ backgroundColor: '#ffffff' }}
      >
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              menuOpen
                ? 'bg-cognigram-50 text-cognigram-600'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-cognigram-600'
            }`}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="absolute left-0 top-[44px] z-40 w-[260px] rounded-xl border border-neutral-200/80 bg-white shadow-[0_18px_40px_-10px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
              >
                {me && (
                  <div className="flex items-center gap-3 border-b border-neutral-100 px-3 py-3">
                    <Avatar
                      id={me.id}
                      email={me.email}
                      name={me.name}
                      picture={me.picture}
                      size={42}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-neutral-900">
                        {displayNameFor(me)}
                      </div>
                      <div className="truncate text-[12px] text-neutral-500">
                        {me.username ? `@${me.username}` : me.email}
                      </div>
                    </div>
                  </div>
                )}
                <ul className="py-1.5">
                  <MenuItem
                    icon={<UserIcon className="h-4 w-4" />}
                    label="My profile"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/profile')
                    }}
                  />
                  <MenuItem
                    icon={<SettingsIcon className="h-4 w-4" />}
                    label="Settings"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="my-1 h-px bg-neutral-100" />
                  <MenuItem
                    icon={<LogoutIcon className="h-4 w-4" />}
                    label="Log out"
                    danger
                    onClick={() => {
                      setMenuOpen(false)
                      onLogout()
                    }}
                  />
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people, channels"
            className="h-9 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-800 outline-none transition-colors focus:border-cognigram-300"
          />
        </div>

        {/* Create menu — new chat / group / channel. */}
        <div ref={composeMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setComposeMenuOpen((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              composeMenuOpen
                ? 'bg-cognigram-50 text-cognigram-600'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-cognigram-600'
            }`}
            aria-label="Create"
            aria-expanded={composeMenuOpen}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {/* Desktop-only collapse toggle — shrinks the sidebar to an
              avatar-only column. Hidden on mobile (use the hamburger). */}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="ml-1 hidden h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 md:flex"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <AnimatePresence>
            {composeMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-[44px] z-40 w-[220px] rounded-xl border border-neutral-200/80 bg-white py-1.5 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
              >
                <ComposeOption
                  label="New group"
                  onClick={() => {
                    setComposeMenuOpen(false)
                    setCreateOpen('group')
                  }}
                />
                <ComposeOption
                  label="New channel"
                  onClick={() => {
                    setComposeMenuOpen(false)
                    setCreateOpen('channel')
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {composing && (
        <motion.form
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          onSubmit={handleStart}
          className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2"
        >
          <input
            ref={newInputRef}
            type="text"
            placeholder="Username or email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="h-9 flex-1 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-cognigram-400"
          />
          <button
            type="submit"
            disabled={busy || !newEmail.trim()}
            className="h-9 rounded-md bg-gradient-to-br from-cognigram-500 to-cognigram-700 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Start
          </button>
        </motion.form>
      )}
      {error && (
        <p className="border-b border-neutral-200 bg-white px-4 py-1.5 text-[12px] text-cognigram-700">
          {error}
        </p>
      )}

      <div className="relative flex-1 overflow-y-auto bg-white">
        {!searching && (
          <>
            {/* Chats section */}
            {filtered.length > 0 && (
              <>
                <SectionLabel>Chats</SectionLabel>
                <ul className="py-1">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <ChatListItem
                        chat={c}
                        meId={meId}
                        active={c.id === activeId}
                        onClick={() => handleSelect(c.id)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {filtered.length === 0 && joinedChannels.length === 0 && (
              <div className="border-b border-neutral-100 px-4 py-4 text-center">
                <p className="text-[13px] font-medium text-neutral-700">
                  No chats yet
                </p>
                <p className="mt-1 text-[12px] text-neutral-400">
                  Search above to find people and channels, or tap + to create one.
                </p>
              </div>
            )}

            {/* Joined groups + channels */}
            {joinedChannels.length > 0 && (
              <>
                <SectionLabel>Channels &amp; groups</SectionLabel>
                <ul className="py-1">
                  {joinedChannels.map((c) => (
                    <li key={c.id}>
                      <ChannelRow
                        channel={c}
                        onClick={() => goToChannel(c)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {/* Unified search results */}
        {searching && (
          <>
            <SectionLabel>
              People
              {filteredUsers.length > 0 && (
                <span className="ml-1 text-neutral-400">
                  · {filteredUsers.length}
                </span>
              )}
            </SectionLabel>
            {filteredUsers.length === 0 ? (
              <p className="px-4 py-4 text-center text-[12.5px] text-neutral-400">
                No people match.
              </p>
            ) : (
              <ul className="py-1">
                {filteredUsers.map((c) => (
                  <li key={c.id}>
                    <ContactRow
                      contact={c}
                      starting={startingContactId === c.id}
                      onClick={() => startWithContact(c)}
                    />
                  </li>
                ))}
              </ul>
            )}

            <SectionLabel>
              Channels
              {foundChannels.length > 0 && (
                <span className="ml-1 text-neutral-400">
                  · {foundChannels.length}
                </span>
              )}
            </SectionLabel>
            {foundChannels.length === 0 ? (
              <p className="px-4 py-4 text-center text-[12.5px] text-neutral-400">
                No channels match.
              </p>
            ) : (
              <ul className="py-1">
                {foundChannels.map((c) => (
                  <li key={c.id}>
                    <ChannelRow
                      channel={c}
                      onClick={() => goToChannel(c)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {foundPacks.length > 0 && (
              <>
                <SectionLabel>
                  Sticker packs
                  <span className="ml-1 text-neutral-400">
                    · {foundPacks.length}
                  </span>
                </SectionLabel>
                <ul className="py-1">
                  {foundPacks.map((p) => (
                    <li key={p.id}>
                      <PackRow
                        pack={p}
                        installing={installingPackId === p.id}
                        onInstall={() => installPack(p)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      <CreateChannel
        open={createOpen !== null}
        initialKind={createOpen ?? 'group'}
        onClose={() => setCreateOpen(null)}
      />
    </aside>
  )
}

function ComposeOption({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center px-3 py-2 text-left text-[13.5px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
    >
      {label}
    </button>
  )
}

function PackRow({
  pack,
  installing,
  onInstall,
}: {
  pack: StickerPack
  installing: boolean
  onInstall: () => void
}) {
  return (
    <div className="flex w-full items-center gap-3 bg-white px-3 py-2.5">
      <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" />
          <line x1="9" y1="10" x2="9.01" y2="10" />
          <line x1="15" y1="10" x2="15.01" y2="10" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-neutral-900">
          {pack.name}
        </div>
        <div className="truncate text-[12px] text-neutral-500">
          @{pack.uname} · {pack.sticker_count} sticker
          {pack.sticker_count === 1 ? '' : 's'}
        </div>
      </div>
      {pack.is_installed ? (
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-500">
          Installed
        </span>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          className="rounded-full bg-cognigram-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cognigram-700 disabled:opacity-50"
        >
          {installing ? '…' : 'Install'}
        </button>
      )}
    </div>
  )
}

function ChannelRow({
  channel,
  onClick,
}: {
  channel: Channel
  onClick: () => void
}) {
  // Typing only flows in groups; broadcast-channel buckets are always empty.
  const typingBucket = useTyping((s) => s.raw[typingKey('group', channel.id)])
  const typingName = typingBucket
    ? Object.values(typingBucket)
        .filter((e) => e.exp > Date.now())
        .map((e) => e.name)[0]
    : undefined

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
    >
      <Avatar
        id={channel.id}
        email={channel.uname}
        name={channel.name}
        picture={channel.avatar}
        size={42}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold text-neutral-900">
            {channel.name}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide ${
              channel.kind === 'channel'
                ? 'bg-cognigram-100 text-cognigram-700'
                : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {channel.kind}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {typingName ? (
              <div className="flex items-center gap-1.5 truncate text-[12px] text-cognigram-600">
                <span className="truncate">{typingName} is typing</span>
                <TypingDots />
              </div>
            ) : (
              <div className="truncate text-[12px] text-neutral-500">
                {channel.member_count} member
                {channel.member_count === 1 ? '' : 's'}
              </div>
            )}
          </div>
          {channel.unread_count > 0 && (
            <span
              aria-label={`${channel.unread_count} unread`}
              className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-cognigram-600 px-1.5 text-[10.5px] font-semibold leading-none text-white shadow-sm"
            >
              {channel.unread_count >= 100 ? '99+' : channel.unread_count}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[13.5px] transition-colors ${
          danger
            ? 'text-cognigram-700 hover:bg-cognigram-50'
            : 'text-neutral-700 hover:bg-neutral-50'
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            danger ? 'text-cognigram-600' : 'text-neutral-500'
          }`}
        >
          {icon}
        </span>
        <span className="font-medium">{label}</span>
      </button>
    </li>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center bg-white px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
      {children}
    </div>
  )
}

function ContactRow({
  contact,
  starting,
  onClick,
}: {
  contact: Contact | UserHit
  starting: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={starting}
      whileTap={{ scale: 0.985 }}
      className="flex w-full items-center gap-3 bg-white px-3 py-2.5 text-left transition-colors hover:bg-white disabled:opacity-60"
    >
      <Avatar
        id={contact.id}
        email={contact.email}
        name={contact.name}
        picture={contact.picture}
        size={42}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-neutral-900">
          {displayNameFor(contact)}
        </div>
        <div className="truncate text-[12px] text-neutral-500">
          {starting
            ? 'Starting chat…'
            : contact.username
              ? `@${contact.username}`
              : contact.email}
        </div>
      </div>
    </motion.button>
  )
}

/* -------------------- collapsed mode -------------------- */

function CollapsedSidebar(props: {
  chats: Chat[]
  meId: string | undefined
  activeId: string | null
  onSelectChat: (id: string) => void
  joinedChannels: Channel[]
  onSelectChannel: (channel: Channel) => void
  onExpand: () => void
  onOpenCreate: (kind: ChannelKind) => void
  createOpen: ChannelKind | null
  onCreateClose: () => void
}) {
  const {
    chats,
    meId,
    activeId,
    onSelectChat,
    joinedChannels,
    onSelectChannel,
    onExpand,
    onOpenCreate,
    createOpen,
    onCreateClose,
  } = props

  return (
    <aside className="relative hidden h-full w-[72px] shrink-0 flex-col items-center gap-2 border-r border-neutral-200 bg-white py-2 md:flex">
      {/* Expand toggle */}
      <button
        type="button"
        onClick={onExpand}
        className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600"
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {/* Create */}
      <button
        type="button"
        onClick={() => onOpenCreate('group')}
        className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600"
        aria-label="New group"
        title="New group / channel"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <div className="my-1 h-px w-8 bg-neutral-200" />

      {/* Scrollable column of avatars */}
      <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-3">
        {chats.map((c) => {
          const other = c.participants.find((p) => p.id !== meId) ?? c.participants[0]
          return (
            <CollapsedRow
              key={`dm-${c.id}`}
              active={c.id === activeId}
              onClick={() => onSelectChat(c.id)}
              title={
                other?.name ||
                other?.username ||
                other?.email ||
                'Chat'
              }
              unread={c.unread_count}
            >
              <Avatar
                id={other?.id ?? c.id}
                email={other?.email ?? ''}
                name={other?.name}
                picture={other?.picture}
                size={44}
              />
            </CollapsedRow>
          )
        })}
        {joinedChannels.map((ch) => (
          <CollapsedRow
            key={`ch-${ch.id}`}
            active={false}
            onClick={() => onSelectChannel(ch)}
            title={ch.name}
            unread={ch.unread_count}
          >
            <Avatar
              id={ch.id}
              email={ch.uname}
              name={ch.name}
              picture={ch.avatar}
              size={44}
            />
          </CollapsedRow>
        ))}
      </div>

      <CreateChannel
        open={createOpen !== null}
        initialKind={createOpen ?? 'group'}
        onClose={onCreateClose}
      />
    </aside>
  )
}

function CollapsedRow({
  active,
  onClick,
  title,
  unread,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  unread: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`relative flex h-12 w-12 items-center justify-center rounded-full transition-shadow ${
        active ? 'ring-2 ring-cognigram-500' : 'hover:ring-2 hover:ring-neutral-200'
      }`}
    >
      {children}
      {unread > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cognigram-600 px-1 text-[9.5px] font-semibold leading-none text-white shadow-sm">
          {unread >= 100 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}
