import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { buttonVariants } from '@heroui/react'
import { Logo } from '../components/Logo'
import { Background } from '../components/Background'
import { AnimatedPage } from '../components/AnimatedPage'

export default function Landing() {
  return (
    <AnimatedPage className="relative h-screen w-screen overflow-hidden">
      <Background className="absolute inset-0" />

      {/* White tint over the gradient for legibility */}
      <div className="pointer-events-none absolute inset-0 bg-white/55" />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6">
        <Logo size={128} />

        <motion.h1
          className="mt-8 text-5xl font-semibold tracking-tight text-keracross-800 sm:text-6xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }}
        >
          Keracross
        </motion.h1>

        <motion.p
          className="mt-3 max-w-md text-center text-base text-neutral-700 sm:text-lg"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
        >
          A faster, sharper way to talk. Built for focus.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.5, ease: 'easeOut' }}
        >
          <Link
            to="/signup"
            className={buttonVariants({ variant: 'primary', size: 'lg' }) + ' min-w-44'}
          >
            Create account
          </Link>
          <Link
            to="/login"
            className={buttonVariants({ variant: 'ghost', size: 'lg' }) + ' min-w-44'}
          >
            Log in
          </Link>
        </motion.div>

        <motion.p
          className="absolute bottom-6 text-xs text-neutral-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.6 }}
        >
          Click the background to shift the gradient.
        </motion.p>
      </div>
    </AnimatedPage>
  )
}
