import { useCallback, useEffect, useRef, useState } from "react"
import { createCrawdClient, type CrawdClient } from "crawd/client"
import { motion, AnimatePresence } from "motion/react"
import type { ReplyTurnEvent } from "crawd"
import { OverlayFace } from "./components/OverlayFace"
import { OverlayBubble } from "./components/OverlayBubble"
import { useAudioAnalysis } from "./hooks/useAudioAnalysis"

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000"
const BUBBLE_GAP = 1500

/** Per-provider volume levels (0–1). TikTok is louder than other providers. */
const PROVIDER_VOLUME: Record<string, number> = {
  tiktok: 0.7,
}
const DEFAULT_VOLUME = 0.8

function volumeForProvider(provider?: string): number {
  return provider ? (PROVIDER_VOLUME[provider] ?? DEFAULT_VOLUME) : DEFAULT_VOLUME
}

type TurnPhase = 'idle' | 'chat' | 'response'

/** Unified queue item — either a talk or reply-turn, processed one at a time */
type QueueItem =
  | { type: 'talk'; id: string; text: string; ttsUrl: string; ttsProvider?: string }
  | { type: 'reply-turn'; id: string; turn: ReplyTurnEvent }

export function Overlay() {
  // Unified audio queue — talk and reply-turn events are serialized through one queue
  const queueRef = useRef<QueueItem[]>([])
  const processingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Visual state driven by the queue processor
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle')
  const [currentTurn, setCurrentTurn] = useState<ReplyTurnEvent | null>(null)
  const [currentMessage, setCurrentMessage] = useState<{ text: string } | null>(null)

  // Client ref for sending acks back to backend
  const clientRef = useRef<CrawdClient | null>(null)

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'sleep' | 'idle' | 'vibing' | 'chatting' | 'active'>('sleep')
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('crawd:debug') === '1')
  const [talkText, setTalkText] = useState(() => localStorage.getItem('crawd:talkText') ?? '')
  const [mockUsername, setMockUsername] = useState(() => localStorage.getItem('crawd:mockUsername') ?? 'viewer123')
  const [mockMessage, setMockMessage] = useState(() => localStorage.getItem('crawd:mockMessage') ?? '')
  const [chatText, setChatText] = useState(() => localStorage.getItem('crawd:chatText') ?? '')
  const [debugResponse, setDebugResponse] = useState(() => localStorage.getItem('crawd:debugResponse') ?? 'This is a test response from the bot!')
  const [debugLoading, setDebugLoading] = useState(false)
  const [showAll, setShowAll] = useState(() => localStorage.getItem('crawd:showAll') === '1')

  const { amplitude, connectAudio } = useAudioAnalysis()

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  /** Send ack to backend — audio finished playing for this event */
  const sendAck = useCallback((id: string) => {
    clientRef.current?.emit('talk:done', { id })
  }, [])

  /** Clean up after an item finishes, then schedule next */
  const finishItem = useCallback((id: string, next: () => void) => {
    clearTimer()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setTurnPhase('idle')
    setCurrentTurn(null)
    setCurrentMessage(null)
    sendAck(id)
    timerRef.current = setTimeout(next, BUBBLE_GAP)
  }, [sendAck])

  /** Process next item from the unified queue */
  const processNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      processingRef.current = false
      return
    }

    processingRef.current = true
    const item = queueRef.current.shift()!

    if (item.type === 'talk') {
      // --- Talk: show bubble, play TTS, ack when done ---
      setCurrentMessage({ text: item.text })

      const finish = () => finishItem(item.id, processNext)

      if (item.ttsUrl) {
        if (audioRef.current) audioRef.current.pause()
        const audio = new Audio(item.ttsUrl)
        audio.volume = volumeForProvider(item.ttsProvider)
        audio.crossOrigin = "anonymous"
        audioRef.current = audio
        audio.onended = () => { timerRef.current = setTimeout(finish, 1500) }
        audio.onerror = () => { timerRef.current = setTimeout(finish, 3000) }
        connectAudio(audio)
        audio.play().catch(() => { timerRef.current = setTimeout(finish, 3000) })
        timerRef.current = setTimeout(finish, 30000)
      } else {
        // No TTS (debug mode) — show bubble briefly then finish
        timerRef.current = setTimeout(finish, 3000)
      }
    } else {
      // --- Reply-turn: chat phase → response phase → ack ---
      const { turn } = item
      setCurrentTurn(turn)
      setTurnPhase('chat')

      const startResponsePhase = () => {
        clearTimer()
        setTurnPhase('response')

        const responseAudio = new Audio(turn.botTtsUrl)
        responseAudio.volume = volumeForProvider(turn.botTtsProvider)
        responseAudio.crossOrigin = "anonymous"
        audioRef.current = responseAudio
        connectAudio(responseAudio)

        const finish = () => finishItem(item.id, processNext)

        responseAudio.onended = () => { timerRef.current = setTimeout(finish, 1500) }
        responseAudio.onerror = () => { timerRef.current = setTimeout(finish, 3000) }
        responseAudio.play().catch(() => { timerRef.current = setTimeout(finish, 3000) })

        timerRef.current = setTimeout(finish, 30000)
      }

      // Phase 1: Show chat message and play chat TTS
      const chatAudio = new Audio(turn.chatTtsUrl)
      chatAudio.volume = volumeForProvider(turn.chatTtsProvider)
      audioRef.current = chatAudio

      chatAudio.onended = () => { clearTimer(); timerRef.current = setTimeout(startResponsePhase, 500) }
      chatAudio.onerror = () => { clearTimer(); timerRef.current = setTimeout(startResponsePhase, 500) }
      chatAudio.play().catch(() => { clearTimer(); timerRef.current = setTimeout(startResponsePhase, 500) })

      timerRef.current = setTimeout(startResponsePhase, 15000)
    }
  }, [connectAudio, finishItem])

  /** Add an item to the unified queue */
  const enqueue = useCallback((item: QueueItem) => {
    queueRef.current.push(item)
    if (!processingRef.current) processNext()
  }, [processNext])

  // Persist debug field values to localStorage
  useEffect(() => { localStorage.setItem('crawd:talkText', talkText) }, [talkText])
  useEffect(() => { localStorage.setItem('crawd:mockUsername', mockUsername) }, [mockUsername])
  useEffect(() => { localStorage.setItem('crawd:mockMessage', mockMessage) }, [mockMessage])
  useEffect(() => { localStorage.setItem('crawd:chatText', chatText) }, [chatText])
  useEffect(() => { localStorage.setItem('crawd:debugResponse', debugResponse) }, [debugResponse])
  useEffect(() => { localStorage.setItem('crawd:showAll', showAll ? '1' : '0') }, [showAll])

  // Debug mode toggle (Ctrl+D) — persisted in localStorage
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

  const sendTalk = () => {
    if (!talkText.trim()) return
    enqueue({ type: 'talk', id: `debug-${Date.now()}`, text: talkText, ttsUrl: '' })
    setTalkText('')
  }

  const sendMockChat = async () => {
    if (!mockMessage.trim()) return
    await fetch(`${SOCKET_URL}/mock/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: mockUsername || 'viewer123', message: mockMessage }),
    })
    setMockMessage('')
  }

  const sendTurn = async () => {
    if (!chatText.trim() || debugLoading) return
    setDebugLoading(true)
    try {
      const res = await fetch(`${SOCKET_URL}/mock/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'debug_user', message: chatText, response: debugResponse }),
      })
      if (!res.ok) console.error('Failed to send mock turn:', await res.text())
    } catch (e) {
      console.error('Failed to send mock turn:', e)
    } finally {
      setDebugLoading(false)
      setChatText('')
    }
  }

  // Connect to backend via SDK
  useEffect(() => {
    const client = createCrawdClient(SOCKET_URL)
    clientRef.current = client

    client.on('connect', () => setConnected(true))
    client.on('disconnect', () => setConnected(false))

    client.on('reply-turn', (data) => {
      enqueue({ type: 'reply-turn', id: data.id, turn: data })
    })

    client.on('talk', (data) => {
      enqueue({ type: 'talk', id: data.id, text: data.message, ttsUrl: data.ttsUrl, ttsProvider: data.ttsProvider })
    })

    client.on('status', (data) => {
      setStatus(data.status as typeof status)
    })

    return () => {
      client.destroy()
      clientRef.current = null
      if (timerRef.current) clearTimeout(timerRef.current)
      if (audioRef.current) audioRef.current.pause()
    }
  }, [enqueue])

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
        <OverlayFace status={turnPhase !== 'idle' || currentMessage ? 'chatting' : status} audioAmplitude={amplitude} />
      </div>

      {/* Debug Panel (Ctrl+D to toggle) */}
      {debugMode && (
        <div className="absolute top-6 left-6 bg-black/90 p-4 rounded-lg text-white font-mono text-sm space-y-3 min-w-[300px]">
          <div className="border-b border-white/20 pb-2">
            <div className="text-lg font-bold">Debug Panel (Ctrl+D to close)</div>
          </div>

          <div>
            <div className="text-white/60 mb-1">Set Status:</div>
            <div className="flex gap-2">
              {(['sleep', 'idle', 'vibing', 'chatting'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-3 py-1 rounded ${status === s ? 'bg-white text-black' : 'bg-white/20 hover:bg-white/30'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-white/60 mb-1">Talk:</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={talkText}
                onChange={e => setTalkText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendTalk()}
                placeholder="Bot says..."
                className="flex-1 px-2 py-1 rounded bg-white/10 border border-white/20 focus:outline-none focus:border-white/40"
              />
              <button onClick={sendTalk} className="px-3 py-1 rounded bg-white/20 hover:bg-white/30">
                Send
              </button>
            </div>
          </div>

          <div>
            <div className="text-white/60 mb-1">Mock Chat (→ coordinator):</div>
            <div className="space-y-2">
              <input
                type="text"
                value={mockUsername}
                onChange={e => setMockUsername(e.target.value)}
                placeholder="Username"
                className="w-full px-2 py-1 rounded bg-white/10 border border-white/20 focus:outline-none focus:border-white/40"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mockMessage}
                  onChange={e => setMockMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMockChat()}
                  placeholder="Chat message..."
                  className="flex-1 px-2 py-1 rounded bg-white/10 border border-white/20 focus:outline-none focus:border-white/40"
                />
                <button
                  onClick={sendMockChat}
                  disabled={!mockMessage.trim()}
                  className="px-3 py-1 rounded bg-green-500/50 hover:bg-green-500/70 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="text-white/60 mb-1">Chat says, bot replies:</div>
            <div className="space-y-2">
              <input
                type="text"
                value={chatText}
                onChange={e => setChatText(e.target.value)}
                placeholder="Chat message..."
                className="w-full px-2 py-1 rounded bg-white/10 border border-white/20 focus:outline-none focus:border-white/40"
              />
              <input
                type="text"
                value={debugResponse}
                onChange={e => setDebugResponse(e.target.value)}
                placeholder="Bot response..."
                className="w-full px-2 py-1 rounded bg-white/10 border border-white/20 focus:outline-none focus:border-white/40"
              />
              <button
                onClick={sendTurn}
                disabled={debugLoading || !chatText.trim()}
                className={`w-full px-3 py-1 rounded ${debugLoading ? 'bg-blue-500/30 cursor-wait' : 'bg-blue-500/50 hover:bg-blue-500/70'} disabled:opacity-50`}
              >
                {debugLoading ? 'Generating TTS...' : 'Send'}
              </button>
            </div>
          </div>

          <div>
            <div className="text-white/60 mb-1">Audio Amplitude:</div>
            <div className="h-2 bg-white/10 rounded overflow-hidden">
              <div className="h-full bg-green-500 transition-all duration-50" style={{ width: `${amplitude * 100}%` }} />
            </div>
            <div className="text-white/40 text-xs mt-1">{(amplitude * 100).toFixed(0)}%</div>
          </div>

          <button
            onClick={() => setShowAll(prev => !prev)}
            className={`w-full px-3 py-1 rounded ${showAll ? 'bg-yellow-500 text-black' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {showAll ? 'Hide all elements' : 'Show all elements'}
          </button>

          <div className="text-white/40 text-xs">
            status={status}, connected={connected ? 'yes' : 'no'}, turnPhase={turnPhase}
          </div>
        </div>
      )}
    </div>
  )
}
