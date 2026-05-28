import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { TypingDots } from './TypingDots'
import { ChannelManage } from './ChannelManage'
import { channels, type Channel } from '../api/channels'
import type { Message, Participant } from '../api/chat'
import { ApiError } from '../api/client'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { useAppData } from '../store/app-data'
import type { ChatSocket } from '../lib/ws'
import { useTyping, typingKey } from '../store/typing'
import { groupMessages } from './helpers'
import { MenuIcon } from './icons'

type Props = {
  uname: string
  /** Shared socket from the parent shell; we attach our own listener for
   *  `channel_message` + `typing` events targeting THIS channel. */
  socket: ChatSocket | null
}

export function ChannelView({ uname, socket }: Props) {
  const me = useAuth((s) => s.user)
  const toggleSidebar = useUi((s) => s.toggleSidebar)

  // Pull the cached channel from the shared store. If the sidebar already
  // populated it (joined list, search result, recent visit) we render the
  // header on the first paint — no blank flash while the network request is
  // in flight.
  const cachedChannel = useAppData((s) =>
    s.channels.find((c) => c.uname.toLowerCase() === uname.toLowerCase()),
  )
  const upsertChannel = useAppData((s) => s.upsertChannel)

  const [channel, setChannel] = useState<Channel | null>(
    cachedChannel ?? null,
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [senders, setSenders] = useState<Record<string, Participant>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stuckBottomRef = useRef(true)

  // Background refresh: always re-fetch on uname change so stale member
  // counts / kind toggles / avatar URLs roll forward, but DON'T blank the UI
  // while we wait. The cached header keeps rendering until the new payload
  // arrives.
  useEffect(() => {
    setLoadError(null)
    if (!uname) return
    if (cachedChannel) {
      setChannel(cachedChannel)
    }
    setMessages([])
    setSenders({})
    let cancelled = false
    channels
      .byUname(uname)
      .then((c) => {
        if (cancelled) return
        setChannel(c)
        upsertChannel(c)
      })
      .catch((e) => {
        if (cancelled) return
        // Only show an error if we have NOTHING to show (no cached row).
        if (!cachedChannel) {
          if (e instanceof ApiError && e.status === 404) {
            setLoadError('No channel with that handle.')
          } else if (e instanceof ApiError) {
            setLoadError(e.message)
          } else {
            setLoadError('Could not load channel.')
          }
        }
      })
    return () => {
      cancelled = true
    }
    // We intentionally don't depend on `cachedChannel` — using only `uname`
    // means switching channels triggers exactly one background fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uname])

  // Initial history once we know we're a member.
  useEffect(() => {
    if (!channel || !channel.is_member) return
    let cancelled = false
    channels
      .history(channel.id, { limit: 50 })
      .then((res) => {
        if (cancelled) return
        setMessages(res.messages)
        setSenders(res.senders)
        // Reset the unread badge for THIS channel now that the viewer has
        // it on screen.
        const last = res.messages[res.messages.length - 1]
        if (last && socket) socket.sendChannelRead(channel.id, last.id)
        if (channel.unread_count > 0) {
          upsertChannel({ ...channel, unread_count: 0 })
        }
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, channel?.is_member, socket])

  // Subscribe to channel + typing events on the parent's socket.
  useEffect(() => {
    if (!socket || !channel?.is_member) return
    const off = socket.on((event) => {
      if (event.type === 'typing') {
        useTyping.getState().set(
          typingKey(event.payload.target_kind, event.payload.target_id),
          event.payload.user_id,
          event.payload.user_name,
          event.payload.started,
        )
        return
      }
      if (event.type !== 'channel_message') return
      const m = event.payload
      if (m.chat_id !== channel.id) return
      setMessages((prev) =>
        prev.some((p) => p.id === m.id) ? prev : [...prev, m],
      )
      // Active viewer → mark read so the unread badge stays at 0.
      if (socket && me && m.sender_id !== me.id) {
        socket.sendChannelRead(channel.id, m.id)
      }
      setSenders((prev) => {
        if (prev[m.sender_id]) return prev
        if (me && m.sender_id === me.id) {
          return {
            ...prev,
            [m.sender_id]: {
              id: me.id,
              email: me.email,
              username: me.username,
              name: me.name,
              picture: me.picture,
            },
          }
        }
        return prev
      })
    })
    return () => {
      off()
    }
  }, [socket, channel?.id, channel?.is_member, me])

  // Stick to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stuckBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stuckBottomRef.current = dist < 80
  }

  const grouped = useMemo(() => groupMessages(messages), [messages])

  const handleJoin = async () => {
    if (!channel) return
    setJoining(true)
    try {
      const updated = await channels.join(channel.id)
      setChannel(updated)
      upsertChannel(updated)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not join.')
    } finally {
      setJoining(false)
    }
  }

  const handleLeave = async () => {
    if (!channel) return
    try {
      await channels.leave(channel.id)
      const next = { ...channel, is_member: false }
      setChannel(next)
      upsertChannel(next)
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not leave.')
    }
  }

  const canPost =
    !!channel?.is_member &&
    (channel.kind === 'group' || channel.is_owner)

  const handleSend = (body: string, attachmentId?: string) => {
    if (!channel || !canPost) return
    socket?.sendChannel(channel.id, body, attachmentId)
  }

  const handleTyping = (started: boolean) => {
    if (!channel || channel.kind !== 'group') return
    socket?.sendTyping('group', channel.id, started)
  }

  if (loadError) {
    return (
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-base text-neutral-700">{loadError}</p>
      </div>
    )
  }

  if (!channel || !me) {
    return (
      <div className="relative z-10 flex h-full items-center justify-center">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="relative z-10 flex h-full flex-col">
      {/* Header */}
      <header className="z-10 flex h-[64px] items-center gap-2 border-b border-neutral-200/70 bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-cognigram-600 md:hidden"
          aria-label="Open sidebar"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <Avatar
          id={channel.id}
          email={channel.uname}
          name={channel.name}
          picture={channel.avatar}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-neutral-900">
            <span className="truncate">{channel.name}</span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                channel.kind === 'channel'
                  ? 'bg-cognigram-100 text-cognigram-700'
                  : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {channel.kind}
            </span>
          </div>
          <ChannelSubtitle channel={channel} senders={senders} meId={me.id} />
        </div>
        {channel.is_owner && channel.is_member && (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12.5px] font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
          >
            Manage
          </button>
        )}
        {channel.is_member && !channel.is_owner && (
          <button
            type="button"
            onClick={handleLeave}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Leave
          </button>
        )}
      </header>

      {!channel.is_member ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <Avatar
            id={channel.id}
            email={channel.uname}
            name={channel.name}
            picture={channel.avatar}
            size={96}
          />
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
            {channel.name}
          </h2>
          {channel.description && (
            <p className="max-w-md text-center text-sm text-neutral-600">
              {channel.description}
            </p>
          )}
          <p className="text-[13px] text-neutral-500">
            @{channel.uname} · {channel.member_count} member
            {channel.member_count === 1 ? '' : 's'}
          </p>
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            className="rounded-full bg-gradient-to-br from-cognigram-500 to-cognigram-700 px-5 py-2 text-sm font-medium text-white shadow-md disabled:opacity-50"
          >
            {joining ? 'Joining…' : `Join ${channel.kind}`}
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex-1 overflow-hidden">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="absolute inset-0 overflow-y-auto py-3 pl-2 pr-3"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="flex w-full flex-col">
                {grouped.map((item) => {
                  if (item.kind === 'divider') {
                    return (
                      <motion.div
                        key={item.key}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="my-3 flex items-center justify-center"
                      >
                        <span className="rounded-full bg-black/45 px-3 py-1 text-[11.5px] font-medium text-white shadow-sm backdrop-blur">
                          {item.label}
                        </span>
                      </motion.div>
                    )
                  }
                  const m = item.msg
                  const mine = m.sender_id === me.id
                  const sender = senders[m.sender_id]
                  const senderName =
                    sender?.name ||
                    sender?.username ||
                    sender?.email ||
                    (mine ? 'You' : `User ${m.sender_id}`)
                  return (
                    <div
                      key={item.key}
                      className={`flex items-end gap-2 ${
                        mine ? 'flex-row-reverse' : ''
                      } ${item.isFirstOfRun ? 'mt-2' : 'mt-[2px]'}`}
                    >
                      <div className="w-7 shrink-0">
                        {item.showAvatar && sender && (
                          <Avatar
                            id={sender.id}
                            email={sender.email}
                            name={sender.name}
                            picture={sender.picture}
                            size={28}
                          />
                        )}
                      </div>
                      <div
                        className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[78%] ${
                          mine ? 'items-end' : 'items-start'
                        }`}
                      >
                        {!mine && item.isFirstOfRun && (
                          <span className="mb-0.5 ml-3 text-[11px] font-medium text-cognigram-700">
                            {senderName}
                          </span>
                        )}
                        <MessageBubble
                          msg={m}
                          mine={mine}
                          hasTail={item.hasTail}
                          isFirstOfRun={item.isFirstOfRun}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {canPost ? (
            <Composer onSend={handleSend} onTyping={handleTyping} />
          ) : (
            <div className="border-t border-neutral-200/70 bg-white/90 px-4 py-3 text-center text-[13px] text-neutral-500 backdrop-blur-md">
              Only the owner can post in this channel.{' '}
              <span aria-hidden>📣</span>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {manageOpen && channel.is_owner && (
          <ChannelManage
            channel={channel}
            onClose={() => setManageOpen(false)}
            onUpdated={(c) => {
              setChannel(c)
              upsertChannel(c)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ChannelSubtitle({
  channel,
  senders,
  meId,
}: {
  channel: Channel
  senders: Record<string, Participant>
  meId: string
}) {
  const typing = useTyping((s) => s.raw[typingKey('group', channel.id)])
  const now = Date.now()
  const liveTypers = typing
    ? Object.entries(typing)
        .filter(([uid, e]) => e.exp > now && uid !== meId)
        .map(([uid, e]) => ({ id: uid, name: e.name }))
    : []

  if (liveTypers.length > 0) {
    const first = liveTypers[0]
    const fallback = senders[first.id]
    const name =
      first.name ||
      fallback?.name ||
      fallback?.username ||
      fallback?.email ||
      'Someone'
    const more = liveTypers.length - 1
    return (
      <div className="flex items-center gap-1.5 truncate text-[12px] text-cognigram-600">
        <span className="truncate">
          {name}
          {more > 0 ? ` and ${more} more` : ''} is typing
        </span>
        <TypingDots />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 truncate text-[12px] text-neutral-500">
      <span>@{channel.uname}</span>
      <span aria-hidden>·</span>
      <span>
        {channel.member_count} member{channel.member_count === 1 ? '' : 's'}
      </span>
    </div>
  )
}
