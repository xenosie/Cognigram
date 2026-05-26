import type { Message } from '../api/chat'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Listener = (msg: Message) => void

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
    const url =
      BASE.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(this.token)}`
    this.ws = new WebSocket(url)

    this.ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data?.type === 'message' && data.payload) {
          this.listeners.forEach((l) => l(data.payload as Message))
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

  send(chatId: string, body: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'send', chat_id: chatId, body }))
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
