import { useEffect, useState, memo } from "react"
import { motion, AnimatePresence } from "motion/react"

type OverlayBubbleProps = {
  message: string | null
  replyTo: string | null
}

function useTypewriter(text: string | null, speed = 30) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    if (!text) { setDisplayed(""); return }
    setDisplayed("")
    let i = 0
    const interval = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(interval)
    }, speed)
    return () => clearInterval(interval)
  }, [text, speed])

  return displayed
}

export const OverlayBubble = memo(function OverlayBubble({ message, replyTo }: OverlayBubbleProps) {
  const displayed = useTypewriter(message)

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="relative bg-white rounded-3xl rounded-br-none px-10 py-6 max-w-[520px] min-w-[300px] border border-black/20"
          style={{
            boxShadow: `
              0 -1px 1px hsl(0deg 0% 0% / 0.05),
              0 -2px 2px hsl(0deg 0% 0% / 0.05),
              0 -4px 4px hsl(0deg 0% 0% / 0.05),
              0 1px 1px hsl(0deg 0% 0% / 0.075),
              0 2px 2px hsl(0deg 0% 0% / 0.075),
              0 4px 4px hsl(0deg 0% 0% / 0.075),
              0 8px 8px hsl(0deg 0% 0% / 0.075),
              0 16px 16px hsl(0deg 0% 0% / 0.075)
            `,
          }}
          initial={{ opacity: 0, scale: 0, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -10 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
        >
          {replyTo && (
            <div className="mb-3 border-l-2 border-black/20 pl-3">
              <p className="text-black/50 text-base italic leading-snug">{replyTo}</p>
            </div>
          )}
          <p className="text-black text-2xl font-medium leading-relaxed">
            {displayed}
            {displayed.length < (message?.length ?? 0) && (
              <motion.span
                className="inline-block w-[2px] h-[1em] bg-black/60 ml-0.5 align-middle"
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, times: [0, 0.49, 0.5, 1] }}
              />
            )}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
