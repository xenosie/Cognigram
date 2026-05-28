import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PATTERNS,
  THEMES,
  useWallpaper,
  type WallpaperPattern,
  type WallpaperTheme,
} from '../store/wallpaper'

type Props = {
  open: boolean
  onClose: () => void
}

export function WallpaperPicker({ open, onClose }: Props) {
  const themeId = useWallpaper((s) => s.themeId)
  const patternId = useWallpaper((s) => s.patternId)
  const setTheme = useWallpaper((s) => s.setTheme)
  const setPattern = useWallpaper((s) => s.setPattern)
  const reset = useWallpaper((s) => s.reset)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/15 backdrop-blur-[2px]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="fixed right-0 top-0 z-50 flex h-screen w-[360px] flex-col bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5"
          >
            <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900">
                Customise chat background
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M6 6l12 12M6 18 18 6" />
                </svg>
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-4">
              {/* Themes */}
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                  Colour theme
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {THEMES.map((t) => (
                    <ThemeSwatch
                      key={t.id}
                      theme={t}
                      active={t.id === themeId}
                      onClick={() => setTheme(t.id)}
                    />
                  ))}
                </div>
              </section>

              {/* Patterns */}
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
                  Texture
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {PATTERNS.map((p) => (
                    <PatternSwatch
                      key={p.id}
                      pattern={p}
                      ink={
                        THEMES.find((t) => t.id === themeId)?.ink ?? '#000'
                      }
                      active={p.id === patternId}
                      onClick={() => setPattern(p.id)}
                    />
                  ))}
                </div>
              </section>
            </div>

            <footer className="border-t border-neutral-200 px-4 py-3">
              <button
                type="button"
                onClick={reset}
                className="w-full rounded-full border border-neutral-200 px-4 py-2 text-[13px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Reset to default
              </button>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function ThemeSwatch({
  theme,
  active,
  onClick,
}: {
  theme: WallpaperTheme
  active: boolean
  onClick: () => void
}) {
  const [c1, c2, c3, c4] = theme.colors
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-stretch gap-1 rounded-xl p-1 transition-colors ${
        active ? 'ring-2 ring-cognigram-500' : 'ring-1 ring-neutral-200 hover:ring-neutral-300'
      }`}
    >
      <div
        className="h-14 w-full rounded-lg"
        style={{
          background: `conic-gradient(from 180deg at 50% 50%, ${c1}, ${c2}, ${c3}, ${c4}, ${c1})`,
        }}
      />
      <span className="px-1 text-[11px] font-medium text-neutral-700">
        {theme.label}
      </span>
    </button>
  )
}

function PatternSwatch({
  pattern,
  ink,
  active,
  onClick,
}: {
  pattern: WallpaperPattern
  ink: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-stretch gap-1 rounded-xl p-1 transition-colors ${
        active ? 'ring-2 ring-cognigram-500' : 'ring-1 ring-neutral-200 hover:ring-neutral-300'
      }`}
    >
      <div
        className="h-14 w-full rounded-lg bg-neutral-50"
        style={
          pattern.src
            ? {
                backgroundColor: '#fff',
                WebkitMaskImage: `url(${pattern.src})`,
                maskImage: `url(${pattern.src})`,
                WebkitMaskSize: '110px',
                maskSize: '110px',
                WebkitMaskRepeat: 'repeat',
                maskRepeat: 'repeat',
                backgroundImage: `linear-gradient(${ink}, ${ink})`,
              }
            : undefined
        }
      />
      <span className="px-1 text-[11px] font-medium text-neutral-700">
        {pattern.label}
      </span>
    </button>
  )
}
