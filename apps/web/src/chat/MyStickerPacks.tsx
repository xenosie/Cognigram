import { useEffect, useRef, useState } from 'react'
import {
  stickers,
  type PackWithStickers,
  type Sticker,
} from '../api/stickers'
import { ApiError } from '../api/client'

const HANDLE_RE = /^[a-z0-9_]+$/

/**
 * Inline panel for the Profile page: lists packs the current user owns,
 * lets them create new ones and upload stickers into them. Default packs
 * (`is_default`) are filtered out so they don't appear here.
 */
export function MyStickerPacks() {
  const [packs, setPacks] = useState<PackWithStickers[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const reload = () => {
    setLoading(true)
    stickers
      .list()
      .then((data) => setPacks(data.filter((p) => p.pack.is_owner)))
      .catch(() => setPacks([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    reload()
  }, [])

  return (
    <section className="border-t border-neutral-100 pt-8">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">
            Your sticker packs
          </h2>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            Anyone who searches @handle can install your pack.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-full bg-cognigram-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-cognigram-700"
        >
          New pack
        </button>
      </div>

      {createOpen && (
        <CreatePackForm
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            reload()
          }}
        />
      )}

      {loading && packs.length === 0 && (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
      {!loading && packs.length === 0 && (
        <p className="text-sm text-neutral-500">
          You don't own any sticker packs yet.
        </p>
      )}

      <div className="space-y-6">
        {packs.map((p) => (
          <PackEditor
            key={p.pack.id}
            initial={p}
            onChanged={() => reload()}
          />
        ))}
      </div>
    </section>
  )
}

function CreatePackForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [uname, setUname] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handle = uname.trim().toLowerCase()
  const handleInvalid =
    handle.length > 0 && (handle.length < 5 || !HANDLE_RE.test(handle))
  const canSubmit = handle.length >= 5 && !handleInvalid && name.trim().length > 0 && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await stickers.create({ uname: handle, name: name.trim() })
      onCreated()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        setError('That handle is taken.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not create.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[1fr_1fr_auto]"
    >
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-neutral-700">
          Handle
        </span>
        <div className="flex items-center rounded-lg border border-neutral-200 bg-white px-2 focus-within:border-cognigram-400">
          <span className="select-none text-[13px] text-neutral-400">@</span>
          <input
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            placeholder="my_stickers"
            autoComplete="off"
            className="h-9 w-full bg-transparent pl-1 text-[13.5px] outline-none"
          />
        </div>
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-neutral-700">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Pack name"
          maxLength={64}
          className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[13.5px] outline-none focus:border-cognigram-400"
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-9 rounded-full bg-cognigram-600 px-4 text-[12.5px] font-medium text-white hover:bg-cognigram-700 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-full px-3 text-[12.5px] font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="col-span-full text-[12px] text-cognigram-600">{error}</p>
      )}
    </form>
  )
}

function PackEditor({
  initial,
  onChanged,
}: {
  initial: PackWithStickers
  onChanged: () => void
}) {
  const [pack] = useState(initial.pack)
  const [items, setItems] = useState<Sticker[]>(initial.stickers)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handlePick = () => fileInputRef.current?.click()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 512 * 1024) {
      setError('Sticker must be 512 KB or smaller.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const sticker = await stickers.uploadSticker(pack.id, file)
      setItems((prev) => [...prev, sticker])
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <div className="text-[14px] font-semibold text-neutral-900">
            {pack.name}
          </div>
          <div className="text-[11.5px] text-neutral-500">
            @{pack.uname} · {items.length} sticker
            {items.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : '+ Add sticker'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/webp,image/gif,video/webm"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {error && <p className="mb-2 text-[12px] text-cognigram-600">{error}</p>}
      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-400">
          No stickers yet. Upload PNG, WEBP, GIF, or WebM (≤512 KB) — 512×512
          transparent works best.
        </p>
      ) : (
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
          {items.map((s) => (
            <div
              key={s.id}
              className="flex aspect-square items-center justify-center rounded-lg bg-neutral-50"
            >
              {s.mime === 'video/webm' ? (
                <video
                  src={s.url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-contain"
                />
              ) : (
                <img
                  src={s.url}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
