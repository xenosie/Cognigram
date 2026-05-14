import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Button,
  FieldError,
  Input,
  InputOTP,
  Label,
  TextField,
} from '@heroui/react'
import { Logo } from '../components/Logo'
import { Background } from '../components/Background'
import { AnimatedPage } from '../components/AnimatedPage'

type Step = 'credentials' | 'totp'

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    // TODO: wire to /auth/login endpoint
    await new Promise((r) => setTimeout(r, 400))
    setSubmitting(false)
    setStep('totp')
  }

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    setSubmitting(true)
    // TODO: wire to /auth/login/verify-totp
    await new Promise((r) => setTimeout(r, 400))
    setSubmitting(false)
    navigate('/')
  }

  return (
    <AnimatedPage className="relative h-screen w-screen overflow-hidden">
      <div className="grid h-full w-full grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
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
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="mt-10"
            >
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
                {step === 'credentials' ? 'Welcome back' : 'Two-factor code'}
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                {step === 'credentials'
                  ? 'Log in to continue to Keracross.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </p>

              {step === 'credentials' ? (
                <form onSubmit={handleCredentials} className="mt-8 space-y-5">
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
                    value={password}
                    onChange={setPassword}
                    type="password"
                    autoComplete="current-password"
                    isRequired
                  >
                    <Label>Password</Label>
                    <Input placeholder="••••••••" />
                    <FieldError />
                  </TextField>

                  <Button
                    type="submit"
                    variant="primary"
                    fullWidth
                    isDisabled={submitting}
                  >
                    {submitting ? 'Signing in…' : 'Continue'}
                  </Button>
                </form>
              ) : (
                <form
                  onSubmit={handleTotp}
                  className="mt-8 flex flex-col items-start gap-6"
                >
                  <InputOTP
                    value={code}
                    onChange={setCode}
                    maxLength={6}
                  >
                    <InputOTP.Group>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTP.Slot key={i} index={i} />
                      ))}
                    </InputOTP.Group>
                  </InputOTP>

                  <div className="flex w-full gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      onPress={() => setStep('credentials')}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      fullWidth
                      isDisabled={submitting || code.length !== 6}
                    >
                      {submitting ? 'Verifying…' : 'Verify & log in'}
                    </Button>
                  </div>
                </form>
              )}

              <p className="mt-8 text-sm text-neutral-500">
                Don't have an account?{' '}
                <Link
                  to="/signup"
                  className="font-medium text-keracross-600 hover:text-keracross-700"
                >
                  Sign up
                </Link>
              </p>
            </motion.div>
          </div>
        </div>

        {/* Brand / animated panel */}
        <div className="relative hidden lg:block">
          <Background className="absolute inset-0" interactive={false} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-keracross-900/30 via-keracross-700/20 to-keracross-500/10" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.6, ease: 'easeOut' }}
              className="text-center"
            >
              <Logo size={120} animated={false} className="mx-auto" />
              <p className="mt-6 max-w-sm px-6 text-lg font-medium text-white drop-shadow">
                Talk fast. Stay focused.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </AnimatedPage>
  )
}
