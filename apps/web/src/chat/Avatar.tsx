import { motion } from 'framer-motion'
import { colorForId, displayNameFromEmail, initialsFromName } from './helpers'

type AvatarProps = {
  id: string
  email: string
  size?: number
  className?: string
  animated?: boolean
}

export function Avatar({
  id,
  email,
  size = 54,
  className = '',
  animated = false,
}: AvatarProps) {
  const [c1, c2] = colorForId(id)
  const initials = initialsFromName(displayNameFromEmail(email))
  const fontSize = Math.round(size * 0.4)

  const inner = (
    <div
      className={`relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-white shadow-sm ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        fontSize,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {initials}
    </div>
  )

  if (!animated) return inner
  return (
    <motion.span
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="inline-block"
    >
      {inner}
    </motion.span>
  )
}
