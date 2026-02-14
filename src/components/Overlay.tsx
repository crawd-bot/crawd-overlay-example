'use client'

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { OverlayFace } from "./OverlayFace"
import { OverlayBubble } from "./OverlayBubble"
import { DebugPanel } from "./DebugPanel"
import { useOverlayController } from "@/hooks/useOverlayController"

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"

export function Overlay() {
  const { controller, snapshot } = useOverlayController(SOCKET_URL)
  const { status, turnPhase, currentTurn, currentMessage, showAll } = snapshot

  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('crawd:debug') === '1'
  })

  // Debug mode toggle (Ctrl+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        setDebugMode(prev => {
          const next = !prev
          localStorage.setItem('crawd:debug', next ? '1' : '0')
          return next
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="w-screen h-screen relative">
      {/* Branding */}
      <div className="absolute bottom-6 right-6">
        <span
          className="text-white text-xl uppercase"
          style={{
            fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 900,
            WebkitTextStroke: "5px black", paintOrder: "stroke fill",
          }}
        >
          x.com/crawdbot
        </span>
      </div>

      {/* Chat message bubble (turn phase: chat, or pinned via showAll) */}
      <AnimatePresence>
        {(showAll || (turnPhase === 'chat' && currentTurn)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              className="relative bg-white rounded-3xl rounded-bl-none px-12 py-8 max-w-[640px] min-w-[340px] border border-black/20"
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
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <p
                className="text-black text-4xl"
                style={{ fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 600 }}
              >
                {currentTurn?.chat.message ?? "Hey, what do you think about this?"}
              </p>
              <p
                className="text-black/50 text-lg mt-3"
                style={{ fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 500 }}
              >
                — {currentTurn?.chat.username ?? "viewer123"}
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bot response bubble (turn phase: response) + talk messages */}
      <div className="absolute bottom-[140px] right-[240px]">
        <AnimatePresence>
          {turnPhase === 'response' && currentTurn && (
            <OverlayBubble key="turn-response" message={currentTurn.botMessage} replyTo={null} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showAll
            ? <OverlayBubble key="show-all" message="Oh that's a great question, let me think about it!" replyTo={null} />
            : currentMessage && <OverlayBubble key="talk" message={currentMessage.text} replyTo={null} />
          }
        </AnimatePresence>
      </div>

      {/* Avatar */}
      <div className="absolute bottom-18 right-5.5">
        <OverlayFace status={turnPhase !== 'idle' || currentMessage ? 'chatting' : status} controller={controller} />
      </div>

      {/* Debug Panel (Ctrl+D to toggle) */}
      {debugMode && <DebugPanel controller={controller} snapshot={snapshot} />}
    </div>
  )
}
