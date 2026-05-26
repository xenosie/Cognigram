import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, InputOTP } from '@heroui/react'
import { Logo } from '../components/Logo'
import { Background } from '../components/Background'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../store/auth'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setTokens = useAuth((s) => s.setTokens)

  const [email] = useState(() => params.get('email') ?? '')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState<string | null>(null)

  useEffect(() => {
    if (!email) navigate('/signup', { replace: true })
  }, [email, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    setSubmitting(true)
    setError(null)
    try {
      const tokens = await auth.verifyEmail(email, code)
      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in)
      navigate('/setup-2fa', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('That code is wrong or expired.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setResendNote(null)
    try {
      await auth.resendVerification(email)
      setResendNote('A new code is on its way.')
    } catch {
      setResendNote('Could not resend right now.')
    } finally {
      setResending(false)
    }
  }

  return (
    <AnimatedPage className="relative h-screen w-screen overflow-hidden">
      <div className="grid h-full w-full grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
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
                Check your email
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-neutral-700">{email}</span>.
                It expires in 10 minutes.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                <InputOTP value={code} onChange={setCode} maxLength={6}>
                  <InputOTP.Group>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTP.Slot key={i} index={i} />
                    ))}
                  </InputOTP.Group>
                </InputOTP>

                {error && (
                  <p className="text-sm text-keracross-600">{error}</p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  isDisabled={submitting || code.length !== 6}
                >
                  {submitting ? 'Verifying…' : 'Verify email'}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-keracross-600 hover:text-keracross-700"
                  onClick={handleResend}
                  disabled={resending}
                >
                  {resending ? 'Resending…' : 'Resend code'}
                </button>
                <Link to="/login" className="text-neutral-500 hover:text-neutral-700">
                  Use a different account
                </Link>
              </div>
              {resendNote && (
                <p className="mt-2 text-xs text-neutral-500">{resendNote}</p>
              )}
            </motion.div>
          </div>
        </div>

        <div className="relative hidden lg:block">
          <Background className="absolute inset-0" interactive={false} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-keracross-900/30 via-keracross-700/20 to-keracross-500/10" />
        </div>
      </div>
    </AnimatedPage>
  )
}
