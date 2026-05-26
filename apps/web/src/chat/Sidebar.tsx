import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { Chat } from '../api/chat'
import { users, type Contact } from '../api/users'
import { ChatListItem } from './ChatListItem'
import {
  LogoutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from './icons'
import { Avatar } from './Avatar'
import { useAuth } from '../store/auth'
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
  const [search, setSearch] = useState('')
  const [composing, setComposing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [startingContactId, setStartingContactId] = useState<string | null>(null)
  const newInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Fetch contacts whenever the chat list changes (so newly-chatted users move out)
  useEffect(() => {
    users
      .list({ limit: 200 })
      .then(setContacts)
      .catch(() => setContacts([]))
  }, [chats.length])

  // Hide contacts that already have an open chat in the chat list
  const chatPartnerIds = useMemo(() => {
    const set = new Set<string>()
    for (const c of chats) {
      for (const p of c.participants) if (p.id !== meId) set.add(p.id)
    }
    return set
  }, [chats, meId])

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return contacts
      .filter((c) => !chatPartnerIds.has(c.id))
      .filter(
        (c) =>
          !term ||
          c.email.toLowerCase().includes(term) ||
          (c.username ?? '').toLowerCase().includes(term),
      )
  }, [contacts, chatPartnerIds, search])

  const startWithContact = async (contact: Contact) => {
    setStartingContactId(contact.id)
    try {
      // Prefer username (canonical handle); fall back to email
      await onStartNew(contact.username ?? contact.email)
    } catch {
      // surfaced via the `error` prop already
    } finally {
      setStartingContactId(null)
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      className="relative flex h-full w-[340px] shrink-0 flex-col border-r border-neutral-200"
      style={{ backgroundColor: '#ffffff' }}
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
                ? 'bg-keracross-50 text-keracross-600'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-keracross-600'
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
                    <Avatar id={me.id} email={me.email} size={42} />
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
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    icon={<ShieldIcon className="h-4 w-4" />}
                    label="Two-factor auth"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/setup-2fa')
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
            placeholder="Search"
            className="h-9 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-800 outline-none transition-colors focus:border-keracross-300"
          />
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
            className="h-9 flex-1 rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-keracross-400"
          />
          <button
            type="submit"
            disabled={busy || !newEmail.trim()}
            className="h-9 rounded-md bg-gradient-to-br from-keracross-500 to-keracross-700 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Start
          </button>
        </motion.form>
      )}
      {error && (
        <p className="border-b border-neutral-200 bg-white px-4 py-1.5 text-[12px] text-keracross-700">
          {error}
        </p>
      )}

      <div className="relative flex-1 overflow-y-auto bg-white">
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
                    onClick={() => onSelect(c.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {filtered.length === 0 && !search && (
          <div className="border-b border-neutral-100 px-4 py-4 text-center">
            <p className="text-[13px] font-medium text-neutral-700">
              No chats yet
            </p>
            <p className="mt-1 text-[12px] text-neutral-400">
              Tap a contact below to start your first chat.
            </p>
          </div>
        )}

        {/* Contacts section */}
        <SectionLabel>
          Contacts
          {filteredContacts.length > 0 && (
            <span className="ml-1 text-neutral-400">
              · {filteredContacts.length}
            </span>
          )}
        </SectionLabel>
        {filteredContacts.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-neutral-400">
            {search ? 'No matching people.' : 'No other users on Keracross yet.'}
          </p>
        ) : (
          <ul className="py-1">
            {filteredContacts.map((c) => (
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
      </div>
    </aside>
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
            ? 'text-keracross-700 hover:bg-keracross-50'
            : 'text-neutral-700 hover:bg-neutral-50'
        }`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            danger ? 'text-keracross-600' : 'text-neutral-500'
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
  contact: Contact
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
      <Avatar id={contact.id} email={contact.email} size={42} />
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
