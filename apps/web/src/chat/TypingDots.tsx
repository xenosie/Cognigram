/**
 * Three bouncing dots that signal someone is typing. Pure CSS keyframes,
 * staggered via inline `animation-delay`. Used in the chat / channel header
 * subtitle.
 */
export function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[3px] ${className}`}
      aria-label="typing"
    >
      <Dot delay="0ms" />
      <Dot delay="120ms" />
      <Dot delay="240ms" />
    </span>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-[5px] w-[5px] rounded-full bg-current"
      style={{
        animation: 'cog-typing 1s infinite ease-in-out',
        animationDelay: delay,
      }}
    />
  )
}
