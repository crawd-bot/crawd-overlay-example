import { useCallback, useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"
import { motion, AnimatePresence } from "motion/react"
import type { ReplyTurnEvent, TalkEvent, TtsEvent, StatusEvent } from "@crawd/cli"
import { OverlayFace } from "./components/OverlayFace"
import { OverlayBubble } from "./components/OverlayBubble"
import { useAudioAnalysis } from "./hooks/useAudioAnalysis"

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000"
const BUBBLE_TIMEOUT = 15000
const BUBBLE_GAP = 1500

type TurnPhase = 'idle' | 'chat' | 'response'

type TalkItem = {
  text: string
  replyTo: string | null
  ttsUrl?: string
}

export function Overlay() {
  // Turn-based state
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle')
  const [currentTurn, setCurrentTurn] = useState<ReplyTurnEvent | null>(null)
  const turnQueueRef = useRef<ReplyTurnEvent[]>([])
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnAudioRef = useRef<HTMLAudioElement | null>(null)
  const turnProcessingRef = useRef(false)

  // Vibe message state (no chat context)
  const [currentMessage, setCurrentMessage] = useState<{ text: string; replyTo: string | null } | null>(null)
  const talkQueueRef = useRef<TalkItem[]>([])
  const talkProcessingRef = useRef(false)
  const talkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const talkAudioRef = useRef<HTMLAudioElement | null>(null)

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'sleep' | 'idle' | 'vibing' | 'chatting' | 'active'>('sleep')

  const { amplitude, connectAudio } = useAudioAnalysis()

  const clearTurnTimer = () => {
    if (turnTimerRef.current) { clearTimeout(turnTimerRef.current); turnTimerRef.current = null }
  }

  // Process next turn from queue
  const processNextTurn = useCallback(() => {
    if (turnQueueRef.current.length === 0) {
      turnProcessingRef.current = false
      setTurnPhase('idle')
      setCurrentTurn(null)
      return
    }

    const turn = turnQueueRef.current.shift()!
    setCurrentTurn(turn)
    setTurnPhase('chat')

    const startResponsePhase = () => {
      clearTurnTimer()
      setTurnPhase('response')

      const responseAudio = new Audio(turn.botTtsUrl)
      responseAudio.volume = 0.8
      responseAudio.crossOrigin = "anonymous"
      turnAudioRef.current = responseAudio
      connectAudio(responseAudio)

      const finishTurn = () => {
        clearTurnTimer()
        setTurnPhase('idle')
        setCurrentTurn(null)
        turnTimerRef.current = setTimeout(processNextTurn, BUBBLE_GAP)
      }

      responseAudio.onended = () => { turnTimerRef.current = setTimeout(finishTurn, 1500) }
      responseAudio.onerror = () => { turnTimerRef.current = setTimeout(finishTurn, 3000) }
      responseAudio.play().catch(() => { turnTimerRef.current = setTimeout(finishTurn, 3000) })

      turnTimerRef.current = setTimeout(finishTurn, 30000)
    }

    // Phase 1: Show chat message and play chat TTS
    const chatAudio = new Audio(turn.chatTtsUrl)
    chatAudio.volume = 0.9
    turnAudioRef.current = chatAudio

    chatAudio.onended = () => { clearTurnTimer(); turnTimerRef.current = setTimeout(startResponsePhase, 500) }
    chatAudio.onerror = () => { clearTurnTimer(); turnTimerRef.current = setTimeout(startResponsePhase, 500) }
    chatAudio.play().catch(() => { clearTurnTimer(); turnTimerRef.current = setTimeout(startResponsePhase, 500) })

    turnTimerRef.current = setTimeout(startResponsePhase, 15000)
  }, [connectAudio])

  const enqueueTurn = useCallback((turn: ReplyTurnEvent) => {
    turnQueueRef.current.push(turn)
    if (!turnProcessingRef.current) { turnProcessingRef.current = true; processNextTurn() }
  }, [processNextTurn])

  // Process next talk message (vibe flow)
  const processNextTalk = useCallback(() => {
    if (talkQueueRef.current.length === 0) { talkProcessingRef.current = false; return }

    talkProcessingRef.current = true
    const item = talkQueueRef.current.shift()!
    setCurrentMessage({ text: item.text, replyTo: item.replyTo })

    const finish = () => {
      setCurrentMessage(null)
      talkTimerRef.current = setTimeout(processNextTalk, BUBBLE_GAP)
    }

    if (item.ttsUrl) {
      if (talkAudioRef.current) talkAudioRef.current.pause()
      const audio = new Audio(item.ttsUrl)
      audio.volume = 0.8
      audio.crossOrigin = "anonymous"
      talkAudioRef.current = audio
      audio.onended = () => { talkTimerRef.current = setTimeout(finish, 1500) }
      audio.onerror = () => { talkTimerRef.current = setTimeout(finish, 3000) }
      connectAudio(audio)
      audio.play().catch(() => { talkTimerRef.current = setTimeout(finish, 3000) })
      talkTimerRef.current = setTimeout(finish, 30000)
    } else {
      talkTimerRef.current = setTimeout(finish, BUBBLE_TIMEOUT)
    }
  }, [connectAudio])

  const enqueueTalk = useCallback((item: TalkItem) => {
    talkQueueRef.current.push(item)
    if (!talkProcessingRef.current) processNextTalk()
  }, [processNextTalk])

  // Attach TTS to current talk message
  const attachTts = useCallback((ttsUrl: string) => {
    if (talkProcessingRef.current && talkAudioRef.current === null) {
      if (talkTimerRef.current) clearTimeout(talkTimerRef.current)

      const audio = new Audio(ttsUrl)
      audio.volume = 0.8
      audio.crossOrigin = "anonymous"
      talkAudioRef.current = audio

      const finish = () => {
        setCurrentMessage(null)
        talkAudioRef.current = null
        talkTimerRef.current = setTimeout(processNextTalk, BUBBLE_GAP)
      }

      audio.onended = () => { talkTimerRef.current = setTimeout(finish, 1500) }
      audio.onerror = () => { talkTimerRef.current = setTimeout(finish, 3000) }
      connectAudio(audio)
      audio.play().catch(() => { talkTimerRef.current = setTimeout(finish, 3000) })
      talkTimerRef.current = setTimeout(finish, 30000)
    }
  }, [processNextTalk, connectAudio])

  // Socket.io connection
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] })

    socket.on("connect", () => setConnected(true))
    socket.on("disconnect", () => setConnected(false))

    socket.on("crawd:reply-turn", (data: ReplyTurnEvent) => enqueueTurn(data))

    socket.on("crawd:talk", (data: TalkEvent) => {
      enqueueTalk({ text: data.message, replyTo: data.replyTo ?? null })
    })

    socket.on("crawd:tts", (data: TtsEvent) => attachTts(data.ttsUrl))

    socket.on("crawd:status", (data: StatusEvent) => {
      setStatus(data.status as typeof status)
    })

    return () => {
      socket.disconnect()
      if (turnTimerRef.current) clearTimeout(turnTimerRef.current)
      if (talkTimerRef.current) clearTimeout(talkTimerRef.current)
      if (turnAudioRef.current) turnAudioRef.current.pause()
      if (talkAudioRef.current) talkAudioRef.current.pause()
    }
  }, [enqueueTurn, enqueueTalk, attachTts])

  return (
    <div className="w-screen h-screen relative">
      {/* Connection indicator */}
      {import.meta.env.DEV && (
        <div className="absolute top-4 left-4 z-50">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      )}

      {/* Status label */}
      <div className="absolute bottom-6 left-6">
        <span
          className="text-white text-xl"
          style={{
            fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 900,
            WebkitTextStroke: "5px black", paintOrder: "stroke fill",
          }}
        >
          status: {status}
        </span>
      </div>

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

      {/* Chat message bubble (turn phase: chat) */}
      <AnimatePresence>
        {turnPhase === 'chat' && currentTurn && (
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
                {currentTurn.chat.message}
              </p>
              <p
                className="text-black/50 text-lg mt-3"
                style={{ fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 500 }}
              >
                — {currentTurn.chat.username}
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bot response bubble (turn phase: response) + vibe messages */}
      <div className="absolute bottom-[140px] right-[240px]">
        <AnimatePresence>
          {turnPhase === 'response' && currentTurn && (
            <OverlayBubble message={currentTurn.botMessage} replyTo={null} />
          )}
        </AnimatePresence>
        <OverlayBubble message={currentMessage?.text ?? null} replyTo={currentMessage?.replyTo ?? null} />
      </div>

      {/* Avatar */}
      <div className="absolute bottom-18 right-5.5">
        <OverlayFace status={status} audioAmplitude={amplitude} />
      </div>
    </div>
  )
}
