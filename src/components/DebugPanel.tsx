'use client'

import { useState, useEffect } from "react"
import type { OverlayController } from "@/controller/OverlayController"
import type { OverlaySnapshot } from "@/controller/types"
import { useAmplitude } from "@/hooks/useOverlayController"

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"

type DebugPanelProps = {
  controller: OverlayController
  snapshot: OverlaySnapshot
}

export function DebugPanel({ controller, snapshot }: DebugPanelProps) {
  const amplitude = useAmplitude(controller)

  const [talkText, setTalkText] = useState(() => localStorage.getItem('crawd:talkText') ?? '')
  const [mockUsername, setMockUsername] = useState(() => localStorage.getItem('crawd:mockUsername') ?? 'viewer123')
  const [mockMessage, setMockMessage] = useState(() => localStorage.getItem('crawd:mockMessage') ?? '')
  const [chatText, setChatText] = useState(() => localStorage.getItem('crawd:chatText') ?? '')
  const [debugResponse, setDebugResponse] = useState(() => localStorage.getItem('crawd:debugResponse') ?? 'This is a test response from the bot!')
  const [debugLoading, setDebugLoading] = useState(false)

  useEffect(() => { localStorage.setItem('crawd:talkText', talkText) }, [talkText])
  useEffect(() => { localStorage.setItem('crawd:mockUsername', mockUsername) }, [mockUsername])
  useEffect(() => { localStorage.setItem('crawd:mockMessage', mockMessage) }, [mockMessage])
  useEffect(() => { localStorage.setItem('crawd:chatText', chatText) }, [chatText])
  useEffect(() => { localStorage.setItem('crawd:debugResponse', debugResponse) }, [debugResponse])

  const sendTalk = () => {
    if (!talkText.trim()) return
    controller.enqueue({ type: 'talk', id: `debug-${Date.now()}`, text: talkText })
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

  const { status, connected, turnPhase, showAll } = snapshot

  return (
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
              onClick={() => controller.setStatus(s)}
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
        <div className="text-white/60 mb-1">{'Mock Chat (-> coordinator):'}</div>
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
            {debugLoading ? 'Sending...' : 'Send'}
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
        onClick={() => controller.setShowAll(!showAll)}
        className={`w-full px-3 py-1 rounded ${showAll ? 'bg-yellow-500 text-black' : 'bg-white/20 hover:bg-white/30'}`}
      >
        {showAll ? 'Hide all elements' : 'Show all elements'}
      </button>

      <div className="text-white/40 text-xs">
        status={status}, connected={connected ? 'yes' : 'no'}, turnPhase={turnPhase}, queue={snapshot.queueLength}
      </div>
    </div>
  )
}
