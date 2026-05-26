import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth, type PublicUser } from '../api/auth'
import { chat, type Chat, type Message } from '../api/chat'
import { useAuth } from '../store/auth'
import { ChatSocket } from '../lib/ws'
import { ApiError } from '../api/client'
import { ChatHeader } from '../chat/ChatHeader'
import { Composer } from '../chat/Composer'
import { EmptyConversation } from '../chat/EmptyConversation'
import { MessageList } from '../chat/MessageList'
import { Sidebar } from '../chat/Sidebar'
import { Wallpaper } from '../chat/Wallpaper'

export default function Home() {
  const navigate = useNavigate()
  const accessToken = useAuth((s) => s.accessToken)
  const refreshToken = useAuth((s) => s.refreshToken)
  const setUser = useAuth((s) => s.setUser)
  const user = useAuth((s) => s.user)
  const clear = useAuth((s) => s.clear)

  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sidebarError, setSidebarError] = useState<string | null>(null)
  const socketRef = useRef<ChatSocket | null>(null)
  // Track active chat inside the WS callback without re-subscribing.
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId],
  )
  const meId = user?.id
  const other = useMemo(() => {
    if (!activeChat || !meId) return null
    return (
      activeChat.participants.find((p) => p.id !== meId) ??
      activeChat.participants[0]
    )
  }, [activeChat, meId])

  /* Load current user */
  useEffect(() => {
    if (user) return
    auth
      .me()
      .then((me: PublicUser) => setUser(me))
      .catch(() => {
        clear()
        navigate('/login', { replace: true })
      })
  }, [user, setUser, clear, navigate])

  /* Initial chat list */
  useEffect(() => {
    chat
      .list()
      .then(setChats)
      .catch(() => setChats([]))
  }, [])

  /* WebSocket */
  useEffect(() => {
    if (!accessToken) return
    const s = new ChatSocket(accessToken)
    s.connect()
    socketRef.current = s
    const off = s.on((m) => {
      if (m.chat_id === activeIdRef.current) {
        setMessages((prev) =>
          prev.some((p) => p.id === m.id) ? prev : [...prev, m],
        )
      }
      setChats((prev) => {
        const i = prev.findIndex((c) => c.id === m.chat_id)
        if (i < 0) return prev
        const next = [...prev]
        next[i] = {
          ...next[i],
          last_message_at: m.created_at,
          last_message_preview: m.body,
        }
        next.sort(
          (a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0),
        )
        return next
      })
    })
    return () => {
      off()
      s.close()
      socketRef.current = null
    }
  }, [accessToken])

  /* History when switching chats */
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let cancelled = false
    chat
      .history(activeId, { limit: 50 })
      .then((m) => {
        if (!cancelled) setMessages(m)
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
    return () => {
      cancelled = true
    }
  }, [activeId])

  const handleStartNew = async (email: string) => {
    setSidebarError(null)
    try {
      const c = await chat.open(email)
      setChats((prev) =>
        prev.some((p) => p.id === c.id) ? prev : [c, ...prev],
      )
      setActiveId(c.id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setSidebarError('No Keracross user with that email.')
        throw new Error('No Keracross user with that email.')
      } else if (e instanceof ApiError && e.status === 400) {
        setSidebarError(e.message)
        throw new Error(e.message)
      } else if (e instanceof ApiError) {
        setSidebarError(e.message)
        throw new Error(e.message)
      } else {
        setSidebarError('Could not start chat.')
        throw new Error('Could not start chat.')
      }
    }
  }

  const handleSend = (body: string) => {
    if (!activeId) return
    socketRef.current?.send(activeId, body)
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
    <AnimatedPage className="flex h-screen w-screen overflow-hidden bg-white">
      <Sidebar
        chats={chats}
        meId={meId}
        activeId={activeId}
        onSelect={setActiveId}
        onStartNew={handleStartNew}
        onLogout={handleLogout}
        error={sidebarError}
      />

      <section className="relative flex h-full min-w-0 flex-1 flex-col">
        <Wallpaper className="-z-0" />

        <AnimatePresence mode="wait">
          {activeChat && other && meId ? (
            <motion.div
              key={activeChat.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 flex h-full flex-col"
            >
              <ChatHeader other={other} />
              <MessageList messages={messages} meId={meId} other={other} />
              <Composer onSend={handleSend} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 flex h-full flex-col"
            >
              <EmptyConversation
                onStartNew={handleStartNew}
                hasChats={chats.length > 0}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </AnimatedPage>
  )
}
