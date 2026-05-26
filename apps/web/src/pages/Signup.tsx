import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Button,
  FieldError,
  Input,
  Label,
  TextField,
} from '@heroui/react'
import { Logo } from '../components/Logo'
import { Background } from '../components/Background'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth } from '../api/auth'
import { ApiError } from '../api/client'

export default function Signup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && confirm !== password
  const tooShort = password.length > 0 && password.length < 8
  const usernameTooShort = username.length > 0 && username.length < 5
  const usernameInvalid =
    username.length > 0 && !/^[A-Za-z0-9_]+$/.test(username)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (
      !email ||
      !username ||
      username.length < 5 ||
      !/^[A-Za-z0-9_]+$/.test(username) ||
      !password ||
      password !== confirm ||
      password.length < 8
    ) {
      setError('Please fix the highlighted fields.')
      return
    }
    setSubmitting(true)
    try {
      await auth.signup(
        email.trim().toLowerCase(),
        username.trim().toLowerCase(),
        password,
      )
      navigate(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`)
    } catch (e) {
      if (e instanceof ApiError && e.message.includes('username')) {
        setError('That username is taken — try another.')
      } else if (e instanceof ApiError && e.code === 'conflict') {
        setError('An account already exists for that email.')
      } else if (e instanceof ApiError) {
        setError(e.message)
      } else {
        setError('Something went wrong. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatedPage className="relative h-screen w-screen overflow-hidden">
      <div className="grid h-full w-full grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        {/* Brand / animated panel */}
        <div className="relative hidden lg:block">
          <Background className="absolute inset-0" interactive={false} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tl from-keracross-900/30 via-keracross-700/20 to-keracross-500/10" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.6, ease: 'easeOut' }}
              className="text-center"
            >
              <Logo size={120} animated={false} className="mx-auto" />
              <p className="mt-6 max-w-sm px-6 text-lg font-medium text-white drop-shadow">
                Three steps to your first chat.
              </p>
            </motion.div>
          </div>
        </div>

        {/* Form panel */}
        <div className="relative flex items-center justify-center bg-white px-6 py-10 sm:px-12">
          <div className="w-full max-w-sm">
            <Link to="/" className="inline-flex items-center gap-2">
              <Logo size={36} animated={false} />
              <span className="text-lg font-semibold tracking-tight text-keracross-800">
                Keracross
              </span>
            </Link>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="mt-10"
            >
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
                Create your account
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                Use your email and a password. We'll send a verification code.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <TextField
                  value={email}
                  onChange={setEmail}
                  type="email"
                  autoComplete="email"
                  isRequired
                >
                  <Label>Email</Label>
                  <Input placeholder="you@domain.com" />
                  <FieldError />
                </TextField>

                <TextField
                  value={username}
                  onChange={setUsername}
                  type="text"
                  autoComplete="username"
                  isRequired
                  isInvalid={usernameTooShort || usernameInvalid}
                >
                  <Label>Username</Label>
                  <Input placeholder="e.g. john_doe (5+ chars, a–z, 0–9, _)" />
                  <FieldError>
                    {usernameInvalid
                      ? 'Only letters, numbers, and underscores.'
                      : usernameTooShort
                        ? 'Username must be at least 5 characters.'
                        : ''}
                  </FieldError>
                </TextField>

                <TextField
                  value={password}
                  onChange={setPassword}
                  type="password"
                  autoComplete="new-password"
                  isRequired
                  isInvalid={tooShort}
                >
                  <Label>Password</Label>
                  <Input placeholder="At least 8 characters" />
                  <FieldError>
                    {tooShort ? 'Password must be at least 8 characters.' : ''}
                  </FieldError>
                </TextField>

                <TextField
                  value={confirm}
                  onChange={setConfirm}
                  type="password"
                  autoComplete="new-password"
                  isRequired
                  isInvalid={mismatch}
                >
                  <Label>Confirm password</Label>
                  <Input placeholder="Re-enter password" />
                  <FieldError>
                    {mismatch ? 'Passwords do not match.' : ''}
                  </FieldError>
                </TextField>

                {error && (
                  <motion.p
                    className="text-sm text-keracross-600"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {error}
                  </motion.p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  isDisabled={submitting}
                >
                  {submitting ? 'Creating account…' : 'Create account'}
                </Button>
              </form>

              <p className="mt-8 text-sm text-neutral-500">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="font-medium text-keracross-600 hover:text-keracross-700"
                >
                  Log in
                </Link>
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </AnimatedPage>
  )
}
