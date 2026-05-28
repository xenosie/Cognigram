import { motion } from 'framer-motion'

type Props = {
  /** True when the user already has at least one chat. */
  hasChats: boolean
}

export function EmptyConversation({ hasChats }: Props) {
  return (
    <div className="relative flex h-full flex-1 items-center justify-center px-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="z-10 rounded-full bg-black/45 px-4 py-1.5 text-[13px] font-medium text-white shadow-md backdrop-blur"
      >
        {hasChats
          ? 'Select a chat to start messaging'
          : 'Pick someone from the sidebar to start your first chat'}
      </motion.div>
    </div>
  )
}
