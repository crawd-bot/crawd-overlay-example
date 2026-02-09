import { useCallback, useEffect, useRef, useState } from "react"
import { createCrawdClient, type CrawdClient } from "@crawd/cli/client"
import { motion, AnimatePresence } from "motion/react"
import type { ReplyTurnEvent } from "@crawd/cli"
import { OverlayFace } from "./components/OverlayFace"
import { OverlayBubble } from "./components/OverlayBubble"
import { useAudioAnalysis } from "./hooks/useAudioAnalysis"

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000"
const BUBBLE_GAP = 1500

type TurnPhase = 'idle' | 'chat' | 'response'

type TalkItem = {
  id: string
  text: string
  ttsUrl: string
}

export function Overlay() {
  // Turn-based state
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('idle')
  const [currentTurn, setCurrentTurn] = useState<ReplyTurnEvent | null>(null)
  const turnQueueRef = useRef<ReplyTurnEvent[]>([])
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnAudioRef = useRef<HTMLAudioElement | null>(null)
  const turnProcessingRef = useRef(false)

  // Talk message state (agent-controlled speech)
  const [currentMessage, setCurrentMessage] = useState<{ text: string } | null>(null)
  const talkQueueRef = useRef<TalkItem[]>([])
  const talkProcessingRef = useRef(false)
  const talkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const talkAudioRef = useRef<HTMLAudioElement | null>(null)

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

  // Process next talk message — always has ttsUrl (atomic event)
  const processNextTalk = useCallback(() => {
    if (talkQueueRef.current.length === 0) { talkProcessingRef.current = false; return }

    talkProcessingRef.current = true
    const item = talkQueueRef.current.shift()!
    setCurrentMessage({ text: item.text })

    const finish = () => {
      // Stop audio and clean up
      if (talkAudioRef.current) {
        talkAudioRef.current.pause()
        talkAudioRef.current = null
      }
      setCurrentMessage(null)

      // Send ack to backend so the agent's tool call resolves
      clientRef.current?.emit('talk:done', { id: item.id })

      talkTimerRef.current = setTimeout(processNextTalk, BUBBLE_GAP)
    }

    // Always have ttsUrl — play audio immediately
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
  }, [connectAudio])

  const enqueueTalk = useCallback((item: TalkItem) => {
    talkQueueRef.current.push(item)
    if (!talkProcessingRef.current) processNextTalk()
  }, [processNextTalk])

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
    // Debug talk — use a local ID, no ack needed
    enqueueTalk({ id: `debug-${Date.now()}`, text: talkText, ttsUrl: '' })
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

    client.on('reply-turn', (data) => enqueueTurn(data))

    client.on('talk', (data) => {
      enqueueTalk({ id: data.id, text: data.message, ttsUrl: data.ttsUrl })
    })

    client.on('status', (data) => {
      setStatus(data.status as typeof status)
    })

    return () => {
      client.destroy()
      clientRef.current = null
      if (turnTimerRef.current) clearTimeout(turnTimerRef.current)
      if (talkTimerRef.current) clearTimeout(talkTimerRef.current)
      if (turnAudioRef.current) turnAudioRef.current.pause()
      if (talkAudioRef.current) talkAudioRef.current.pause()
    }
  }, [enqueueTurn, enqueueTalk])

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
