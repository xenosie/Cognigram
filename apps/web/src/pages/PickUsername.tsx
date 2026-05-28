import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, FieldError, Input, Label, TextField } from '@heroui/react'
import { Logo } from '../components/Logo'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../store/auth'

const USERNAME_RE = /^[a-z0-9_]+$/

export default function PickUsername() {
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalized = username.trim().toLowerCase()
  const tooShort = normalized.length > 0 && normalized.length < 5
  const tooLong = normalized.length > 32
  const invalid = normalized.length > 0 && !USERNAME_RE.test(normalized)

  const canSubmit = normalized.length >= 5 && !tooLong && !invalid && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const user = await auth.setUsername(normalized)
      setUser(user)
      navigate('/app', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        setError('That username is taken. Try another.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not save username.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatedPage className="flex h-screen w-screen items-center justify-center bg-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex items-center gap-2">
          <Logo size={36} animated={false} />
          <span className="text-lg font-semibold tracking-tight text-cognigram-800">
            Cognigram
          </span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Pick a username
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          People can start chats with you using @your_username. You can't change
          this later (yet), so choose something you like.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <TextField
            value={username}
            onChange={setUsername}
            type="text"
            autoComplete="username"
            isRequired
            isInvalid={tooShort || tooLong || invalid}
          >
            <Label>Username</Label>
            <Input placeholder="e.g. john_doe (5–32 chars, a–z, 0–9, _)" />
            <FieldError>
              {invalid
                ? 'Only lowercase letters, digits, and underscores.'
                : tooShort
                  ? 'At least 5 characters.'
                  : tooLong
                    ? 'No more than 32 characters.'
                    : ''}
            </FieldError>
          </TextField>

          {error && <p className="text-sm text-cognigram-600">{error}</p>}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            isDisabled={!canSubmit}
          >
            {submitting ? 'Saving…' : 'Save username'}
          </Button>
        </form>
      </motion.div>
    </AnimatedPage>
  )
}
