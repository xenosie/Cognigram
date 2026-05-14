import { useRef } from 'react'
import { TWallpaper, type TWallpaperHandlers } from '@twallpaper/react'

const BLOOD_RED_PALETTE = [
  '#ffffff',
  '#ffd6d6',
  '#e13b3b',
  '#7a0b0b',
]

type BackgroundProps = {
  className?: string
  /** Tap-to-shift gradient on click */
  interactive?: boolean
}

export function Background({
  className,
  interactive = true,
}: BackgroundProps) {
  const handlers = useRef<TWallpaperHandlers>(null)

  return (
    <div
      className={className}
      onClick={() => interactive && handlers.current?.toNextPosition()}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      <TWallpaper
        ref={handlers}
        options={{
          colors: BLOOD_RED_PALETTE,
          fps: 30,
          tails: 90,
          animate: true,
        }}
      />
    </div>
  )
}
