import type { Chat, Message } from '../api/chat'

/** When VITE_API_URL is empty we hit the same origin the page was served from
 *  (Vite dev proxy / production reverse proxy). */
function wsBase(): string {
  const explicit = import.meta.env.VITE_API_URL as string | undefined
  if (explicit && explicit.length > 0) return explicit.replace(/^http/, 'ws')
  return window.location.origin.replace(/^http/, 'ws')
}

export type TypingTarget = 'dm' | 'group'

export type TypingEvent = {
  target_kind: TypingTarget
  target_id: string
  user_id: string
  user_name: string
  started: boolean
}

export type ReadEvent = {
  chat_id: string
  user_id: string
  msg_id: string
}

export type PresenceEvent = {
  user_id: string
  online: boolean
}

export type ChannelJoinedEvent = {
  channel_id: string
  channel_name: string
  channel_uname: string
  user_id: string
  user_name: string
}

export type IncomingEvent =
  | { type: 'message'; payload: Message }
  | { type: 'channel_message'; payload: Message }
  | { type: 'typing'; payload: TypingEvent }
  | { type: 'read'; payload: ReadEvent }
  | { type: 'presence'; payload: PresenceEvent }
  | { type: 'chat_opened'; payload: Chat }
  | { type: 'channel_joined'; payload: ChannelJoinedEvent }

type Listener = (event: IncomingEvent) => void

export class ChatSocket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private reconnectTimer: number | null = null
  private closed = false
  private token: string

  constructor(token: string) {
    this.token = token
  }

  connect() {
    this.closed = false
    const url = wsBase() + `/ws?token=${encodeURIComponent(this.token)}`
    this.ws = new WebSocket(url)

    this.ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data) as IncomingEvent
        if (
          (data?.type === 'message' ||
            data?.type === 'channel_message' ||
            data?.type === 'typing' ||
            data?.type === 'read' ||
            data?.type === 'presence' ||
            data?.type === 'chat_opened' ||
            data?.type === 'channel_joined') &&
          data.payload
        ) {
          this.listeners.forEach((l) => l(data))
        }
      } catch {
        // ignore malformed frames
      }
    })

    this.ws.addEventListener('close', () => {
      if (!this.closed) this.scheduleReconnect()
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 1500)
  }

  on(l: Listener) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  send(chatId: string, body: string, attachmentId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'send',
          chat_id: chatId,
          body,
          attachment_id: attachmentId ?? null,
        }),
      )
    }
  }

  sendChannel(channelId: string, body: string, attachmentId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'send_channel',
          channel_id: channelId,
          body,
          attachment_id: attachmentId ?? null,
        }),
      )
    }
  }

  /** Tell the server we've read messages up to `msgId` in `chatId`. The
   *  server persists the cursor and fans out a `read` event to the other
   *  participants so they can render double-check / "seen" indicators. */
  sendRead(chatId: string, msgId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: 'read', chat_id: chatId, msg_id: msgId }),
      )
    }
  }

  /** Reset the unread badge for a channel/group. No "seen" broadcast — the
   *  cursor is private to the reader. */
  sendChannelRead(channelId: string, msgId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'read_channel',
          channel_id: channelId,
          msg_id: msgId,
        }),
      )
    }
  }

  sendTyping(targetKind: TypingTarget, targetId: string, started: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'typing',
          target_kind: targetKind,
          target_id: targetId,
          started,
        }),
      )
    }
  }

  close() {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}
