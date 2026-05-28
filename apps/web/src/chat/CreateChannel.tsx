import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { channels, type ChannelKind } from '../api/channels'
import { ApiError } from '../api/client'

type Props = {
  open: boolean
  onClose: () => void
  /** Pre-select Group or Channel; defaults to Group. */
  initialKind?: ChannelKind
}

const HANDLE_RE = /^[a-z0-9_]+$/

export function CreateChannel({ open, onClose, initialKind = 'group' }: Props) {
  const navigate = useNavigate()
  const [kind, setKind] = useState<ChannelKind>(initialKind)
  const [uname, setUname] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setKind(initialKind)
      setUname('')
      setName('')
      setDescription('')
      setError(null)
      setSubmitting(false)
    }
  }, [open, initialKind])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const normalizedHandle = uname.trim().toLowerCase()
  const handleTooShort = normalizedHandle.length > 0 && normalizedHandle.length < 5
  const handleInvalid =
    normalizedHandle.length > 0 && !HANDLE_RE.test(normalizedHandle)
  const trimmedName = name.trim()

  const canSubmit =
    !!normalizedHandle &&
    !handleTooShort &&
    !handleInvalid &&
    trimmedName.length > 0 &&
    !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await channels.create({
        kind,
        uname: normalizedHandle,
        name: trimmedName,
        description: description.trim() || undefined,
      })
      onClose()
      navigate(`/c/${created.uname}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        setError('That handle is taken (by a user or another channel).')
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not create.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          />
          {/* Flex-centering wrapper so framer-motion's transform animations
              don't fight Tailwind's translate-utility centering. */}
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="pointer-events-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
            >
            <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
              Create a new {kind === 'group' ? 'group' : 'channel'}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {kind === 'group'
                ? 'Anyone you invite — or who finds you in search — can join and post.'
                : 'A broadcast channel. Only you can post; everyone else just reads.'}
            </p>

            {/* Kind toggle */}
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-full bg-neutral-100 p-1">
              <KindOption
                label="Group"
                description="Everyone posts"
                active={kind === 'group'}
                onClick={() => setKind('group')}
              />
              <KindOption
                label="Channel"
                description="Broadcast only"
                active={kind === 'channel'}
                onClick={() => setKind('channel')}
              />
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <Field
                label="Handle"
                error={
                  handleInvalid
                    ? 'Lowercase letters, digits, underscores only.'
                    : handleTooShort
                      ? 'At least 5 characters.'
                      : undefined
                }
              >
                <div className="flex items-center rounded-xl border border-neutral-200 bg-white px-3 focus-within:border-cognigram-400">
                  <span className="select-none text-[14px] text-neutral-400">@</span>
                  <input
                    value={uname}
                    onChange={(e) => setUname(e.target.value)}
                    placeholder="e.g. my_group"
                    autoComplete="off"
                    className="h-10 w-full bg-transparent pl-1 text-[14px] outline-none placeholder:text-neutral-400"
                  />
                </div>
              </Field>

              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="A short display name"
                  maxLength={64}
                  className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-[14px] outline-none focus:border-cognigram-400"
                />
              </Field>

              <Field label="Description (optional)">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What's it about?"
                  className="min-h-[64px] w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-cognigram-400"
                />
              </Field>

              {error && (
                <p className="text-sm text-cognigram-600">{error}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-full bg-gradient-to-br from-cognigram-500 to-cognigram-700 px-4 py-2 text-sm font-medium text-white shadow-md disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

function KindOption({
  label,
  description,
  active,
  onClick,
}: {
  label: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start rounded-full px-4 py-2 text-left transition-colors ${
        active
          ? 'bg-white shadow-sm ring-1 ring-black/5'
          : 'text-neutral-600 hover:text-neutral-900'
      }`}
    >
      <span className="text-[13.5px] font-semibold">{label}</span>
      <span className="text-[11px] text-neutral-500">{description}</span>
    </button>
  )
}

function Field({
  label,
  children,
  error,
}: {
  label: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-neutral-700">
        {label}
      </span>
      {children}
      {error && <p className="mt-1 text-[12px] text-cognigram-600">{error}</p>}
    </label>
  )
}
