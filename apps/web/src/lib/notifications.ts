/**
 * Browser desktop notifications for incoming messages.
 *
 * - We only fire when the document is hidden / unfocused, so users actively
 *   reading a chat never get a popup for the message they're already seeing.
 * - First call lazily requests permission; subsequent calls are zero-cost.
 * - Clicking the notification focuses the tab.
 */

let permissionAsked = false

export function ensureNotificationPermission(): void {
  if (typeof window === 'undefined') return
  if (typeof Notification === 'undefined') return
  if (permissionAsked) return
  permissionAsked = true
  if (Notification.permission === 'default') {
    // Fire-and-forget — old browsers return a Promise, ancient ones don't.
    try {
      Notification.requestPermission()?.catch?.(() => {})
    } catch {
      // ignore
    }
  }
}

export function shouldNotify(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof Notification === 'undefined') return false
  if (Notification.permission !== 'granted') return false
  return document.visibilityState !== 'visible' || !document.hasFocus()
}

export function notify(
  title: string,
  body: string,
  options?: { icon?: string; tag?: string; data?: unknown },
): void {
  if (!shouldNotify()) return
  try {
    const n = new Notification(title, {
      body,
      icon: options?.icon ?? '/favicon.svg',
      tag: options?.tag, // collapse repeated notifications for the same chat
      silent: false,
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // ignore — some browsers throw on edge cases
  }
}
