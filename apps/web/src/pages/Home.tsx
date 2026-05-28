import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth, type PublicUser } from '../api/auth'
import { chat, type Chat, type Message } from '../api/chat'
import { useAuth } from '../store/auth'
import { ChatSocket } from '../lib/ws'
import { ApiError } from '../api/client'
import { ChannelView } from '../chat/ChannelView'
import { ChatHeader } from '../chat/ChatHeader'
import { Composer } from '../chat/Composer'
import { EmptyConversation } from '../chat/EmptyConversation'
import { MessageList } from '../chat/MessageList'
import { Sidebar } from '../chat/Sidebar'
import { Wallpaper } from '../chat/Wallpaper'
import { useUi } from '../store/ui'
import { useTyping, typingKey } from '../store/typing'
import { usePresence } from '../store/presence'
import { useAppData } from '../store/app-data'
import {
  ensureNotificationPermission,
  notify,
} from '../lib/notifications'
import { displayNameFor } from '../chat/helpers'

export default function Home() {
  const navigate = useNavigate()
  // `/c/:uname` and `/app` both render Home — `uname` is set on the channel
  // route so we know to render ChannelView instead of the DM view.
  const params = useParams<{ uname?: string }>()
  const channelUname = params.uname?.toLowerCase()
  const [socket, setSocket] = useState<ChatSocket | null>(null)
  const accessToken = useAuth((s) => s.accessToken)
  const refreshToken = useAuth((s) => s.refreshToken)
  const setUser = useAuth((s) => s.setUser)
  const user = useAuth((s) => s.user)
  const clear = useAuth((s) => s.clear)

  // Chats live in the shared app-data store so they survive Home being
  // unmounted/remounted across `/app` ↔ `/c/:uname` navigation. activeId +
  // messages stay local — they're only meaningful when Home is rendering
  // the DM view.
  const chats = useAppData((s) => s.chats)
  const chatsLoaded = useAppData((s) => s.chatsLoaded)
  const setChats = useAppData((s) => s.setChats)
  const markChatsLoaded = useAppData((s) => s.markChatsLoaded)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sidebarError, setSidebarError] = useState<string | null>(null)
  const socketRef = useRef<ChatSocket | null>(null)
  // Track active chat + chat list inside the WS callback without
  // re-subscribing every time they change.
  const activeIdRef = useRef<string | null>(null)
  const chatsRef = useRef<Chat[]>([])
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])
  useEffect(() => {
    chatsRef.current = chats
  }, [chats])

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

  /* Initial chat list. Only the FIRST Home mount triggers the fetch — the
     shared store persists chats across `/app` ↔ `/c/:uname` navigation, so
     remounts don't re-fetch and don't blank the sidebar. On any error we
     leave the existing list intact and keep `chatsLoaded` false so the next
     mount retries. */
  useEffect(() => {
    if (chatsLoaded) return
    chat
      .list()
      .then((cs) => {
        setChats(cs)
        markChatsLoaded()
        const meId = useAuth.getState().user?.id
        const entries: Array<[string, boolean]> = []
        for (const c of cs) {
          for (const p of c.participants) {
            if (p.id !== meId) entries.push([p.id, c.other_online])
          }
        }
        if (entries.length > 0) usePresence.getState().setMany(entries)
      })
      .catch(() => {
        /* preserve whatever we already had */
      })
  }, [chatsLoaded, setChats, markChatsLoaded])

  /* WebSocket */
  useEffect(() => {
    if (!accessToken) return
    // First time we open a socket = good moment to ask for notification
    // permission. The browser ignores the call if the user already chose.
    ensureNotificationPermission()
    const s = new ChatSocket(accessToken)
    s.connect()
    socketRef.current = s
    setSocket(s)
    const off = s.on((event) => {
      if (event.type === 'typing') {
        useTyping.getState().set(
          typingKey(event.payload.target_kind, event.payload.target_id),
          event.payload.user_id,
          event.payload.user_name,
          event.payload.started,
        )
        return
      }
      if (event.type === 'presence') {
        usePresence
          .getState()
          .set(event.payload.user_id, event.payload.online)
        return
      }
      if (event.type === 'read') {
        // Other participant has read up to msg_id — push the cursor forward
        // so OUR outgoing messages flip from ✓ to ✓✓.
        const { chat_id, msg_id } = event.payload
        setChats((prev) => {
          const i = prev.findIndex((c) => c.id === chat_id)
          if (i < 0) return prev
          const curr = prev[i].other_last_read
          // Numeric compare via BigInt-free Number — message IDs fit easily.
          if (Number(msg_id) <= Number(curr)) return prev
          const next = [...prev]
          next[i] = { ...next[i], other_last_read: msg_id }
          return next
        })
        return
      }
      // Channel-side updates the sidebar reads from the shared app-data
      // store. Home is the place we have a guaranteed-mounted WS listener,
      // so channel notifications + unread bumps live here too.
      if (event.type === 'channel_message') {
        const m = event.payload
        const meId2 = useAuth.getState().user?.id
        const isMine = m.sender_id === meId2
        if (!isMine) {
          // Bump the unread badge unless the user is viewing this channel
          // right now (URL = /c/<uname of m.chat_id>).
          const channels = useAppData.getState().channels
          const chan = channels.find((c) => c.id === m.chat_id)
          if (chan) {
            const isViewingThisChannel =
              window.location.pathname === `/c/${chan.uname}`
            if (!isViewingThisChannel) {
              useAppData.getState().upsertChannel({
                ...chan,
                unread_count: Math.min(chan.unread_count + 1, 100),
              })
              // Desktop popup if the tab is hidden / unfocused.
              const preview =
                m.body || (m.attachment ? '📎 Attachment' : '')
              notify(chan.name, preview, { tag: `channel-${chan.id}` })
            }
          }
        }
        return
      }
      if (event.type === 'channel_joined') {
        // Someone joined a group/channel I'm a member of. Owner UX = a
        // small desktop notification; bump member_count locally.
        const { channel_id, channel_name, user_name } = event.payload
        const channels = useAppData.getState().channels
        const chan = channels.find((c) => c.id === channel_id)
        if (chan) {
          useAppData.getState().upsertChannel({
            ...chan,
            member_count: chan.member_count + 1,
          })
        }
        notify(channel_name, `${user_name} joined`, {
          tag: `joined-${channel_id}`,
        })
        return
      }
      if (event.type === 'chat_opened') {
        // Someone started a new DM with us. Insert into the chat store so
        // the sidebar reflects it immediately + fire a notification.
        const newChat = event.payload
        setChats((prev) =>
          prev.some((c) => c.id === newChat.id) ? prev : [newChat, ...prev],
        )
        const me2 = useAuth.getState().user
        const other = newChat.participants.find((p) => p.id !== me2?.id)
        const senderName = other
          ? displayNameFor(other)
          : 'New conversation'
        notify(senderName, 'started a chat with you', {
          tag: `chat-opened-${newChat.id}`,
        })
        return
      }
      if (event.type !== 'message') return
      const m = event.payload
      const isActive = m.chat_id === activeIdRef.current

      // Fire a desktop notification when the tab is hidden or unfocused and
      // the message is from someone other than us. Tag by chat so repeated
      // messages collapse into one popup.
      const meId = useAuth.getState().user?.id
      if (m.sender_id !== meId) {
        // Best-effort sender display name from the chats list.
        const chat = chatsRef.current.find((c) => c.id === m.chat_id)
        const other = chat?.participants.find((p) => p.id !== meId)
        const senderName = other ? displayNameFor(other) : 'New message'
        const preview = m.body || (m.attachment ? '📎 Attachment' : '')
        notify(senderName, preview, { tag: `chat-${m.chat_id}` })
      }
      if (isActive) {
        setMessages((prev) =>
          prev.some((p) => p.id === m.id) ? prev : [...prev, m],
        )
      }
      setChats((prev) => {
        const i = prev.findIndex((c) => c.id === m.chat_id)
        if (i < 0) return prev
        const next = [...prev]
        const sentByMe = meId === m.sender_id
        next[i] = {
          ...next[i],
          last_message_at: m.created_at,
          last_message_preview: m.body,
          // If the chat isn't open, bump unread (unless I sent it).
          unread_count:
            isActive || sentByMe
              ? next[i].unread_count
              : Math.min(next[i].unread_count + 1, 100),
        }
        next.sort(
          (a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0),
        )
        return next
      })
      // If the chat is active right now, acknowledge the read immediately so
      // the sender's ✓✓ flips in real time.
      if (isActive && meId !== m.sender_id) {
        socketRef.current?.sendRead(m.chat_id, m.id)
      }
    })
    return () => {
      off()
      s.close()
      socketRef.current = null
      setSocket(null)
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
        if (cancelled) return
        setMessages(m)
        // Mark every loaded message read at this point.
        const last = m.length > 0 ? m[m.length - 1].id : null
        if (last) socketRef.current?.sendRead(activeId, last)
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
    // Zero out the unread badge locally — server will catch up via WS Read.
    setChats((prev) => {
      const i = prev.findIndex((c) => c.id === activeId)
      if (i < 0 || prev[i].unread_count === 0) return prev
      const next = [...prev]
      next[i] = { ...next[i], unread_count: 0 }
      return next
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
        setSidebarError('No Cognigram user with that email.')
        throw new Error('No Cognigram user with that email.')
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

  const handleSend = (body: string, attachmentId?: string) => {
    if (!activeId) return
    socketRef.current?.send(activeId, body, attachmentId)
  }

  const handleTyping = (started: boolean) => {
    if (!activeId) return
    socketRef.current?.sendTyping('dm', activeId, started)
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

  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const closeSidebar = useUi((s) => s.closeSidebar)

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

      {/* Drawer backdrop on mobile only. */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={closeSidebar}
          className="fixed inset-0 z-30 cursor-default bg-black/30 backdrop-blur-[2px] md:hidden"
        />
      )}

      <section className="relative flex h-full min-w-0 flex-1 flex-col">
        <Wallpaper className="-z-0" />
        {/* Soft white veil over the wallpaper so the message text reads
            better and the room feels calmer. Sits below the chat content
            (z-0) but above the wallpaper. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-white/70"
        />

        {/* No `mode="wait"` — letting the new column fade IN while the old
            fades OUT eliminates the 180 ms blank gap between transitions. */}
        <AnimatePresence>
          {channelUname ? (
            <motion.div
              key={`c-${channelUname}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-10 flex h-full flex-col"
            >
              <ChannelView uname={channelUname} socket={socket} />
            </motion.div>
          ) : activeChat && other && meId ? (
            <motion.div
              key={activeChat.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-10 flex h-full flex-col"
            >
              <ChatHeader other={other} chatId={activeChat.id} />
              <MessageList
                messages={messages}
                meId={meId}
                other={other}
                otherLastRead={activeChat.other_last_read}
              />
              <Composer onSend={handleSend} onTyping={handleTyping} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-10 flex h-full flex-col"
            >
              <EmptyConversation hasChats={chats.length > 0} />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </AnimatedPage>
  )
}
