import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, Input, TextField } from '@heroui/react'
import { Logo } from '../components/Logo'
import { useAuth } from '../store/auth'
import { auth } from '../api/auth'
import { chat as chatApi, type Chat } from '../api/chat'
import { ApiError } from '../api/client'
import { ChatListItem } from './ChatListItem'

type Props = {
  chats: Chat[]
  activeId: string | null
  onSelect: (id: string) => void
  onChatCreated: (c: Chat) => void
}

export function ChatList({ chats, activeId, onSelect, onChatCreated }: Props) {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const refreshToken = useAuth((s) => s.refreshToken)
  const clear = useAuth((s) => s.clear)

  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const filtered = chats.filter((c) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return c.participants.some(
      (p) =>
        p.id !== user?.id &&
        (p.email.toLowerCase().includes(q) ||
          c.last_message_preview?.toLowerCase().includes(q)),
    )
  })

  const handleNewChat = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    setBusy(true)
    try {
      const c = await chatApi.open(email)
      onChatCreated(c)
      setComposing(false)
      setNewEmail('')
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setErr('No Keracross user with that email.')
      } else if (e instanceof ApiError && e.status === 400) {
        setErr(e.message)
      } else {
        setErr('Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    try {
      if (refreshToken) await auth.logout(refreshToken)
    } catch {
      // ignore
    }
    clear()
    navigate('/', { replace: true })
  }

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-neutral-200 bg-white">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
        <Logo size={28} animated={false} />
        <span className="text-[15px] font-semibold tracking-tight text-keracross-800">
          Keracross
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setComposing((v) => !v)}
            title="Start new chat"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
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
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            title="Log out"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-keracross-600"
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
              <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="border-b border-neutral-200 px-3 py-2">
        <TextField value={query} onChange={setQuery}>
          <Input placeholder="Search" />
        </TextField>
      </div>

      {/* Inline "compose" sheet */}
      {composing && (
        <motion.form
          onSubmit={handleNewChat}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="space-y-2 border-b border-neutral-200 bg-keracross-50/50 px-3 py-3"
        >
          <div className="flex items-center gap-2">
            <TextField
              value={newEmail}
              onChange={setNewEmail}
              type="email"
              className="flex-1"
            >
              <Input placeholder="Other user's email" autoFocus />
            </TextField>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isDisabled={busy || !newEmail.trim()}
            >
              Start
            </Button>
          </div>
          {err && (
            <p className="text-[11px] text-keracross-600">{err}</p>
          )}
        </motion.form>
      )}

      {/* Chats */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-400">
            {query ? 'No matches.' : 'No chats yet.'}
          </p>
        ) : (
          <ul className="flex flex-col py-1">
            {filtered.map((c) => (
              <li key={c.id}>
                <ChatListItem
                  chat={c}
                  meId={user?.id}
                  active={c.id === activeId}
                  onClick={() => onSelect(c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
