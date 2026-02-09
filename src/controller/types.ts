import type { ReplyTurnEvent } from 'crawd'
import type { CrawdClient } from 'crawd/client'

export type TurnPhase = 'idle' | 'chat' | 'response'

export type OverlayStatus = 'sleep' | 'idle' | 'vibing' | 'chatting' | 'active'

export type QueueItem =
  | { type: 'talk'; id: string; text: string; ttsUrl: string; ttsProvider?: string }
  | { type: 'reply-turn'; id: string; turn: ReplyTurnEvent }

export type OverlaySnapshot = {
  connected: boolean
  status: OverlayStatus
  turnPhase: TurnPhase
  currentTurn: ReplyTurnEvent | null
  currentMessage: { text: string } | null
  queueLength: number
  showAll: boolean
}

export type OverlayControllerDeps = {
  createClient: (url: string) => CrawdClient
  createAudio: (url: string) => HTMLAudioElement
  createAudioContext: () => AudioContext
  requestAnimationFrame: (cb: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (cb: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}
