import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { Button, InputOTP } from '@heroui/react'
import { Logo } from '../components/Logo'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth, type TotpSetupResponse } from '../api/auth'
import { ApiError } from '../api/client'

export default function Setup2FA() {
  const navigate = useNavigate()
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    auth
      .totpSetup()
      .then((s) => !cancelled && setSetup(s))
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.code === 'conflict') {
          // already enabled — skip
          navigate('/app', { replace: true })
        } else {
          setError(e instanceof ApiError ? e.message : 'Could not load setup.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    setSubmitting(true)
    setError(null)
    try {
      await auth.totpEnable(code)
      navigate('/app', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('That code is wrong. Try the latest code from your app.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => navigate('/app', { replace: true })

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
          <span className="text-lg font-semibold tracking-tight text-keracross-800">
            Keracross
          </span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Add two-factor authentication
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Scan the QR code with Google Authenticator, 1Password, Authy, or any
          TOTP app — then enter the 6-digit code to confirm.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
          {setup ? (
            <>
              <QRCodeSVG
                value={setup.otpauth_url}
                size={196}
                fgColor="#7a0b0b"
                bgColor="#ffffff"
                level="M"
                marginSize={1}
              />
              <details className="w-full text-center text-xs text-neutral-500">
                <summary className="cursor-pointer">Can't scan? Show secret</summary>
                <code className="mt-2 inline-block break-all font-mono text-[11px] text-neutral-700">
                  {setup.secret}
                </code>
              </details>
            </>
          ) : (
            <div className="h-[196px] w-[196px] animate-pulse rounded-md bg-neutral-200" />
          )}
        </div>

        <form onSubmit={handleEnable} className="mt-8 space-y-5">
          <InputOTP value={code} onChange={setCode} maxLength={6}>
            <InputOTP.Group>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTP.Slot key={i} index={i} />
              ))}
            </InputOTP.Group>
          </InputOTP>

          {error && <p className="text-sm text-keracross-600">{error}</p>}

          <div className="flex gap-3">
            <Button type="button" variant="ghost" onPress={handleSkip}>
              Skip for now
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              isDisabled={submitting || code.length !== 6 || !setup}
            >
              {submitting ? 'Enabling…' : 'Enable 2FA'}
            </Button>
          </div>
        </form>
      </motion.div>
    </AnimatedPage>
  )
}
