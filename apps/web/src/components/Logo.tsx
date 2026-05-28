import { motion } from 'framer-motion'
import logoUrl from '../assets/logo.svg'

type LogoProps = {
  size?: number
  animated?: boolean
  className?: string
}

export function Logo({ size = 96, animated = true, className }: LogoProps) {
  if (!animated) {
    return (
      <img
        src={logoUrl}
        width={size}
        height={size}
        alt="Cognigram"
        className={className}
        draggable={false}
      />
    )
  }

  return (
    <motion.img
      src={logoUrl}
      width={size}
      height={size}
      alt="Cognigram"
      className={className}
      draggable={false}
      initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
    />
  )
}
