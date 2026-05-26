import { useState } from 'react'
import { motion } from 'framer-motion'
import { Logo } from '../components/Logo'

type Props = {
  /** Called when the user submits an email from the inline composer. */
  onStartNew: (email: string) => Promise<void>
  /** True when the user already has at least one chat. */
  hasChats: boolean
}

export function EmptyConversation({ onStartNew, hasChats }: Props) {
  if (hasChats) {
    return (
      <div className="relative flex h-full flex-1 items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="z-10 rounded-full bg-black/45 px-4 py-1.5 text-[13px] font-medium text-white shadow-md backdrop-blur"
        >
          Please select a chat to start messaging
        </motion.div>
      </div>
    )
  }

  return <FirstChatCard onStartNew={onStartNew} />
}

function FirstChatCard({
  onStartNew,
}: {
  onStartNew: (email: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      await onStartNew(value)
      setEmail('')
    } catch (err) {
      const msg =
        typeof err === 'object' && err && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Could not start that chat.'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex h-full flex-1 items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
        className="z-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl bg-white/80 px-8 py-8 text-center shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/5 backdrop-blur-xl"
      >
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Logo size={84} animated />
        </motion.div>

        <div>
          <h2 className="text-xl font-semibold tracking-tight text-keracross-800">
            Welcome to Keracross
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-600">
            Enter another Keracross user's email below to open a private,
            real-time conversation with them.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full">
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              autoComplete="email"
              className="h-10 flex-1 rounded-full border border-neutral-200 bg-white px-4 text-[14px] outline-none transition-colors focus:border-keracross-400"
            />
            <motion.button
              type="submit"
              disabled={busy || !email.trim()}
              whileTap={{ scale: 0.95 }}
              className="h-10 rounded-full bg-gradient-to-br from-keracross-500 to-keracross-700 px-4 text-[13.5px] font-medium text-white shadow-md transition-opacity disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start chat'}
            </motion.button>
          </div>
          {error && (
            <p className="mt-2 text-[12px] text-keracross-600">{error}</p>
          )}
        </form>

        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
          <FeaturePill icon="⚡">Realtime</FeaturePill>
          <FeaturePill icon="🔐">Password + 2FA</FeaturePill>
          <FeaturePill icon="✦">No ads, no noise</FeaturePill>
        </div>

        <p className="text-[11.5px] text-neutral-400">
          Tip: click the wallpaper to shift the gradient.
        </p>
      </motion.div>
    </div>
  )
}

function FeaturePill({
  icon,
  children,
}: {
  icon: string
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-keracross-50 px-2.5 py-1 text-[11.5px] font-medium text-keracross-700">
      <span aria-hidden>{icon}</span>
      <span>{children}</span>
    </span>
  )
}
