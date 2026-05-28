import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { colorForId, displayNameFromEmail, initialsFromName } from './helpers'

type AvatarProps = {
  id: string
  email: string
  /** Optional name used to derive initials, preferred over email-local-part. */
  name?: string | null
  /** Optional remote picture URL (Google profile, uploaded avatar, etc.). */
  picture?: string | null
  size?: number
  className?: string
  animated?: boolean
}

export function Avatar({
  id,
  email,
  name,
  picture,
  size = 54,
  className = '',
  animated = false,
}: AvatarProps) {
  // Reset the error flag when the URL changes (e.g. after a new upload).
  const [errored, setErrored] = useState(false)
  useEffect(() => setErrored(false), [picture])

  const [c1, c2] = colorForId(id)
  const initialsSource = (name && name.trim()) || displayNameFromEmail(email)
  const initials = initialsFromName(initialsSource)
  const fontSize = Math.round(size * 0.4)

  const showImage = !!picture && !errored

  const inner = showImage ? (
    <img
      src={picture as string}
      alt=""
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={`inline-block shrink-0 select-none rounded-full object-cover shadow-sm ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  ) : (
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
