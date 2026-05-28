import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, FieldError, Input, Label, TextField } from '@heroui/react'
import { Avatar } from '../chat/Avatar'
import { MyStickerPacks } from '../chat/MyStickerPacks'
import { AnimatedPage } from '../components/AnimatedPage'
import { Logo } from '../components/Logo'
import { auth } from '../api/auth'
import { me as meApi } from '../api/me'
import { ApiError } from '../api/client'
import { useAuth } from '../store/auth'

const USERNAME_RE = /^[a-z0-9_]+$/

export default function Profile() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)

  const [displayName, setDisplayName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileOk, setProfileOk] = useState(false)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Refetch on mount so we always show the current server-side state.
  useEffect(() => {
    auth.me().then(setUser).catch(() => {})
  }, [setUser])

  useEffect(() => {
    setDisplayName(user?.name ?? '')
    setUsername(user?.username ?? '')
  }, [user?.name, user?.username])

  const normalisedHandle = username.trim().toLowerCase()
  const usernameTooShort = normalisedHandle.length > 0 && normalisedHandle.length < 5
  const usernameInvalid =
    normalisedHandle.length > 0 && !USERNAME_RE.test(normalisedHandle)

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileError(null)
    setProfileOk(false)
    if (usernameTooShort || usernameInvalid) {
      setProfileError('Username must be 5+ chars, lowercase a–z / 0–9 / _')
      return
    }
    const patch: { display_name?: string; username?: string } = {}
    const nextName = displayName.trim()
    if (nextName !== (user?.name ?? '')) patch.display_name = nextName
    if (normalisedHandle && normalisedHandle !== (user?.username ?? '')) {
      patch.username = normalisedHandle
    }
    if (!patch.display_name && !patch.username) {
      setProfileOk(true)
      return
    }
    setSavingProfile(true)
    try {
      const updated = await meApi.update(patch)
      setUser(updated)
      setProfileOk(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        setProfileError('That username is taken — try another.')
      } else {
        setProfileError(
          e instanceof ApiError ? e.message : 'Could not save profile.',
        )
      }
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePickFile = () => fileInputRef.current?.click()

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
      const updated = await meApi.uploadAvatar(file)
      setUser(updated)
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setAvatarUploading(false)
    }
  }

  if (!user) {
    return (
      <AnimatedPage className="flex h-screen w-screen items-center justify-center bg-white">
        <p className="text-sm text-neutral-500">Loading profile…</p>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen w-screen overflow-y-auto bg-white">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10 sm:py-14">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link to="/app" className="inline-flex items-center gap-2">
            <Logo size={32} animated={false} />
            <span className="text-base font-semibold tracking-tight text-cognigram-800">
              Cognigram
            </span>
          </Link>
          <Link
            to="/app"
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            ← Back to chats
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="space-y-10"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
            Your profile
          </h1>

          {/* Avatar block */}
          <section className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="relative">
              <Avatar
                id={user.id}
                email={user.email}
                name={user.name}
                picture={user.picture}
                size={96}
              />
              {avatarUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[11px] font-medium text-white">
                  Uploading…
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-900">
                Profile photo
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                JPEG, PNG, GIF or WEBP. Up to 3 MB.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onPress={handlePickFile}
                  isDisabled={avatarUploading}
                >
                  {avatarUploading ? 'Uploading…' : 'Upload new'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              {avatarError && (
                <p className="mt-2 text-xs text-cognigram-600">{avatarError}</p>
              )}
            </div>
          </section>

          {/* Identity form */}
          <form onSubmit={handleSaveProfile} className="space-y-5">
            <TextField
              value={displayName}
              onChange={setDisplayName}
              type="text"
            >
              <Label>Display name</Label>
              <Input placeholder="e.g. Jane Doe" />
              <FieldError />
            </TextField>

            <TextField
              value={username}
              onChange={setUsername}
              type="text"
              isInvalid={usernameTooShort || usernameInvalid}
            >
              <Label>Username</Label>
              <Input placeholder="e.g. jane_doe (5–32 chars, a–z / 0–9 / _)" />
              <FieldError>
                {usernameInvalid
                  ? 'Only lowercase letters, digits, and underscores.'
                  : usernameTooShort
                    ? 'At least 5 characters.'
                    : ''}
              </FieldError>
            </TextField>

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="submit"
                variant="primary"
                isDisabled={savingProfile}
              >
                {savingProfile ? 'Saving…' : 'Save'}
              </Button>
              {profileOk && (
                <span className="text-sm text-emerald-600">Saved.</span>
              )}
              {profileError && (
                <span className="text-sm text-cognigram-600">{profileError}</span>
              )}
            </div>
          </form>

          <MyStickerPacks />

          {/* Read-only email */}
          <section className="border-t border-neutral-100 pt-6">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              Account
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              Signed in as <span className="font-medium">{user.email}</span>{' '}
              (Google)
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Your email is set by Google and can't be changed here.
            </p>
          </section>

          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={() => navigate('/app')}
              className="text-sm text-neutral-500 hover:text-neutral-800"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatedPage>
  )
}
