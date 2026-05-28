import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { Logo } from '../components/Logo'
import { Background } from '../components/Background'
import { AnimatedPage } from '../components/AnimatedPage'
import { auth } from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../store/auth'

export default function Login() {
  const navigate = useNavigate()
  const setTokens = useAuth((s) => s.setTokens)
  const setUser = useAuth((s) => s.setUser)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSuccess = async (credentialResponse: CredentialResponse) => {
    const idToken = credentialResponse.credential
    if (!idToken) {
      setError('Google did not return a credential. Try again.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await auth.googleLogin(idToken)
      setTokens(res.tokens.access_token, res.tokens.refresh_token, res.tokens.expires_in)
      setUser(res.user)
      navigate(res.needs_username ? '/pick-username' : '/app', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'gmail_only') {
        setError('Only @gmail.com accounts are allowed.')
      } else if (e instanceof ApiError && e.code === 'email_not_verified') {
        setError('Your Google account does not have a verified email.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatedPage className="relative h-screen w-screen overflow-hidden">
      <div className="grid h-full w-full grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
        {/* Sign-in panel */}
        <div className="relative flex items-center justify-center bg-white px-6 py-10 sm:px-12">
          <div className="w-full max-w-sm">
            <Link to="/" className="inline-flex items-center gap-2">
              <Logo size={36} animated={false} />
              <span className="text-lg font-semibold tracking-tight text-cognigram-800">
                Cognigram
              </span>
            </Link>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="mt-10"
            >
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
                Welcome
              </h1>

              <div className="mt-10 flex justify-center">
                <GoogleLogin
                  onSuccess={handleSuccess}
                  onError={() => setError('Google sign-in was cancelled.')}
                  theme="filled_black"
                  shape="pill"
                  size="large"
                  text="continue_with"
                />
              </div>

              {submitting && (
                <p className="mt-4 text-center text-sm text-neutral-500">
                  Finishing sign-in…
                </p>
              )}
              {error && (
                <p className="mt-4 text-center text-sm text-cognigram-600">{error}</p>
              )}
            </motion.div>
          </div>
        </div>

        {/* Brand panel */}
        <div className="relative hidden lg:block">
          <Background className="absolute inset-0" interactive={false} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cognigram-900/30 via-cognigram-700/20 to-cognigram-500/10" />
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
