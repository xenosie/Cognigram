import { useEffect, useRef } from 'react'
import { TWallpaper, type TWallpaperHandlers } from '@twallpaper/react'
import { getPattern, getTheme, useWallpaper } from '../store/wallpaper'

type Props = {
  className?: string
}

/**
 * Telegram-style chat wallpaper, driven entirely by the wallpaper preferences
 * store. Theme controls the gradient colours; pattern controls the masked
 * doodle overlay. Both are live-swappable via the WallpaperPicker.
 */
export function Wallpaper({ className = '' }: Props) {
  const themeId = useWallpaper((s) => s.themeId)
  const patternId = useWallpaper((s) => s.patternId)
  const handlers = useRef<TWallpaperHandlers>(null)

  const theme = getTheme(themeId)
  const pattern = getPattern(patternId)

  // Live-update without re-mounting twallpaper.
  useEffect(() => {
    handlers.current?.updateColors(theme.colors)
  }, [theme.colors])
  useEffect(() => {
    handlers.current?.updatePattern(
      pattern.src
        ? {
            image: pattern.src,
            mask: true,
            opacity: 0.5,
            background: theme.ink,
            size: '420px',
          }
        : { image: '', mask: false, opacity: 0 },
    )
  }, [pattern.src, theme.ink])

  return (
    <div
      className={`absolute inset-0 ${className}`}
      onClick={() => handlers.current?.toNextPosition()}
      style={{ cursor: 'default' }}
    >
      <TWallpaper
        ref={handlers}
        options={{
          colors: theme.colors,
          fps: 30,
          tails: 90,
          animate: true,
          pattern: pattern.src
            ? {
                image: pattern.src,
                mask: true,
                opacity: 0.5,
                background: theme.ink,
                size: '420px',
              }
            : undefined,
        }}
      />
    </div>
  )
}
