import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from './Avatar'
import { channels, type Channel } from '../api/channels'
import { ApiError } from '../api/client'

type Props = {
  channel: Channel
  onClose: () => void
  onUpdated: (c: Channel) => void
}

const HANDLE_RE = /^[a-z0-9_]+$/

export function ChannelManage({ channel, onClose, onUpdated }: Props) {
  const [name, setName] = useState(channel.name)
  const [uname, setUname] = useState(channel.uname)
  const [description, setDescription] = useState(channel.description ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const normalized = uname.trim().toLowerCase()
  const handleTooShort = normalized.length > 0 && normalized.length < 5
  const handleInvalid = normalized.length > 0 && !HANDLE_RE.test(normalized)
  const trimmedName = name.trim()
  const canSubmit =
    !handleTooShort &&
    !handleInvalid &&
    trimmedName.length > 0 &&
    !saving

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    const patch: { name?: string; uname?: string; description?: string } = {}
    if (trimmedName !== channel.name) patch.name = trimmedName
    if (normalized !== channel.uname) patch.uname = normalized
    if (description !== (channel.description ?? '')) {
      patch.description = description
    }
    if (Object.keys(patch).length === 0) {
      setSaveOk(true)
      setSaving(false)
      return
    }
    try {
      const updated = await channels.patch(channel.id, patch)
      onUpdated(updated)
      setSaveOk(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        setSaveError('That handle is taken.')
      } else {
        setSaveError(e instanceof ApiError ? e.message : 'Save failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      setAvatarError('Image must be 3 MB or smaller.')
      return
    }
    setAvatarError(null)
    setAvatarUploading(true)
    try {
      const updated = await channels.uploadAvatar(channel.id, file)
      onUpdated(updated)
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setAvatarUploading(false)
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="pointer-events-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
            Manage {channel.kind}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        {/* Avatar block */}
        <section className="mt-6 flex items-center gap-4">
          <div className="relative">
            <Avatar
              id={channel.id}
              email={channel.uname}
              name={channel.name}
              picture={channel.avatar}
              size={72}
            />
            {avatarUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[10px] font-medium text-white">
                …
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-medium text-neutral-900">
              {channel.kind === 'channel' ? 'Channel' : 'Group'} photo
            </p>
            <p className="mt-0.5 text-[11.5px] text-neutral-500">
              JPEG / PNG / GIF / WEBP, up to 3 MB.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="mt-2 rounded-full bg-cognigram-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-cognigram-700 disabled:opacity-50"
            >
              {avatarUploading ? 'Uploading…' : 'Change'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            {avatarError && (
              <p className="mt-1 text-[12px] text-cognigram-600">{avatarError}</p>
            )}
          </div>
        </section>

        {/* Identity form */}
        <form onSubmit={handleSave} className="mt-6 space-y-4">
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
                autoComplete="off"
                className="h-10 w-full bg-transparent pl-1 text-[14px] outline-none placeholder:text-neutral-400"
              />
            </div>
          </Field>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-[14px] outline-none focus:border-cognigram-400"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="min-h-[64px] w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-cognigram-400"
            />
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full bg-gradient-to-br from-cognigram-500 to-cognigram-700 px-4 py-2 text-sm font-medium text-white shadow-md disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveOk && (
              <span className="text-sm text-emerald-600">Saved.</span>
            )}
            {saveError && (
              <span className="text-sm text-cognigram-600">{saveError}</span>
            )}
          </div>
        </form>
        </motion.div>
      </div>
    </>
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
