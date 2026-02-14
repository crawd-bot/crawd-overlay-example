import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OverlayController, volumeForProvider } from './OverlayController'
import type { OverlayControllerDeps, TtsResult } from './types'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type MockAudio = {
  url: string
  volume: number
  crossOrigin: string | null
  onended: (() => void) | null
  onerror: (() => void) | null
  paused: boolean
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  _eventListeners: Map<string, Set<() => void>>
  _simulateEnd: () => void
  _simulateError: () => void
}

function createMockAudio(url: string): MockAudio {
  const listeners = new Map<string, Set<() => void>>()
  const audio: MockAudio = {
    url,
    volume: 1,
    crossOrigin: null,
    onended: null,
    onerror: null,
    paused: true,
    play: vi.fn(() => {
      audio.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      audio.paused = true
      for (const fn of listeners.get('pause') ?? []) fn()
    }),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler)
    }),
    _eventListeners: listeners,
    _simulateEnd() {
      audio.paused = true
      audio.onended?.()
      for (const fn of listeners.get('ended') ?? []) fn()
    },
    _simulateError() {
      audio.onerror?.()
      for (const fn of listeners.get('error') ?? []) fn()
    },
  }
  return audio
}

type MockClient = {
  _handlers: Map<string, (...args: any[]) => void>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  socket: any
  _simulateEvent: (event: string, data?: any) => void
}

function createMockClient(): MockClient {
  const handlers = new Map<string, (...args: any[]) => void>()
  return {
    _handlers: handlers,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn(),
    socket: {},
    _simulateEvent(event: string, data?: any) {
      handlers.get(event)?.(data)
    },
  }
}

type MockDeps = OverlayControllerDeps & {
  _mockClient: MockClient
  _audios: MockAudio[]
  _ttsResponse: TtsResult
}

function createMockDeps(): MockDeps {
  const mockClient = createMockClient()
  const audios: MockAudio[] = []

  const deps: MockDeps = {
    createClient: vi.fn(() => mockClient as any),
    createAudio: vi.fn((url: string) => {
      const audio = createMockAudio(url)
      audios.push(audio)
      return audio as any
    }),
    createAudioContext: vi.fn(() => ({
      state: 'running',
      resume: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      destination: {},
      createAnalyser: vi.fn(() => ({
        fftSize: 0,
        frequencyBinCount: 128,
        connect: vi.fn(),
        getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
      })),
      createMediaElementSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    } as any)),
    requestAnimationFrame: vi.fn(() => 0),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn((cb, _ms) => {
      return timerManager.register(cb)
    }),
    clearTimeout: vi.fn((id) => {
      timerManager.cancel(id)
    }),
    generateTts: vi.fn(async (): Promise<TtsResult> => {
      return deps._ttsResponse
    }),
    createBlobUrl: vi.fn((base64: string) => `blob:mock-${base64.slice(0, 8)}`),
    revokeBlobUrl: vi.fn(),
    _mockClient: mockClient,
    _audios: audios,
    _ttsResponse: { base64: 'AAAA', provider: 'openai' },
  }

  return deps
}

// Simple timer manager for test control
const timerManager = {
  _id: 0,
  _pending: new Map<number, () => void>(),
  register(cb: () => void): number {
    const id = ++timerManager._id
    timerManager._pending.set(id, cb)
    return id
  },
  cancel(id: number): void {
    timerManager._pending.delete(id)
  },
  flush(): void {
    const pending = [...timerManager._pending.entries()]
    timerManager._pending.clear()
    for (const [, cb] of pending) cb()
  },
  flushOne(): void {
    const first = timerManager._pending.entries().next()
    if (first.done) return
    timerManager._pending.delete(first.value[0])
    first.value[1]()
  },
  reset(): void {
    timerManager._pending.clear()
    timerManager._id = 0
  },
  get size(): number {
    return timerManager._pending.size
  },
}

/** Flush microtask queue (await all pending promises) */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('volumeForProvider', () => {
  it('returns 0.7 for tiktok', () => {
    expect(volumeForProvider('tiktok')).toBe(0.7)
  })

  it('returns default 0.8 for openai', () => {
    expect(volumeForProvider('openai')).toBe(0.8)
  })

  it('returns default 0.8 for undefined', () => {
    expect(volumeForProvider(undefined)).toBe(0.8)
  })

  it('returns default 0.8 for unknown provider', () => {
    expect(volumeForProvider('unknown')).toBe(0.8)
  })
})

describe('OverlayController', () => {
  let deps: MockDeps
  let ctrl: OverlayController

  beforeEach(() => {
    timerManager.reset()
    deps = createMockDeps()
    ctrl = new OverlayController('http://localhost:4000', deps)
  })

  afterEach(() => {
    ctrl.destroy()
    timerManager.reset()
  })

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------

  describe('socket lifecycle', () => {
    it('creates client on connect()', () => {
      ctrl.connect()
      expect(deps.createClient).toHaveBeenCalledWith('http://localhost:4000')
    })

    it('registers event handlers on connect', () => {
      ctrl.connect()
      expect(deps._mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(deps._mockClient.on).toHaveBeenCalledWith('disconnect', expect.any(Function))
      expect(deps._mockClient.on).toHaveBeenCalledWith('talk', expect.any(Function))
      expect(deps._mockClient.on).toHaveBeenCalledWith('reply-turn', expect.any(Function))
      expect(deps._mockClient.on).toHaveBeenCalledWith('status', expect.any(Function))
    })

    it('updates connected state on connect/disconnect events', () => {
      ctrl.connect()
      expect(ctrl.getSnapshot().connected).toBe(false)

      deps._mockClient._simulateEvent('connect')
      expect(ctrl.getSnapshot().connected).toBe(true)

      deps._mockClient._simulateEvent('disconnect')
      expect(ctrl.getSnapshot().connected).toBe(false)
    })

    it('updates status on status event', () => {
      ctrl.connect()
      deps._mockClient._simulateEvent('status', { status: 'vibing' })
      expect(ctrl.getSnapshot().status).toBe('vibing')
    })

    it('does not create second client on double connect()', () => {
      ctrl.connect()
      ctrl.connect()
      expect(deps.createClient).toHaveBeenCalledTimes(1)
    })

    it('destroys client on destroy()', () => {
      ctrl.connect()
      ctrl.destroy()
      expect(deps._mockClient.destroy).toHaveBeenCalled()
      expect(ctrl.getSnapshot().connected).toBe(false)
    })

    it('does not connect after destroy', () => {
      ctrl.destroy()
      ctrl.connect()
      expect(deps.createClient).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Subscriber notification
  // -------------------------------------------------------------------------

  describe('subscriber notification', () => {
    it('notifies snapshot listeners on state change', () => {
      const listener = vi.fn()
      ctrl.subscribe(listener)

      ctrl.setStatus('vibing')
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not notify for same value', () => {
      const listener = vi.fn()
      ctrl.subscribe(listener)

      ctrl.setStatus('sleep') // same as initial
      expect(listener).not.toHaveBeenCalled()
    })

    it('unsubscribe stops notifications', () => {
      const listener = vi.fn()
      const unsub = ctrl.subscribe(listener)

      ctrl.setStatus('vibing')
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      ctrl.setStatus('chatting')
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('returns stable snapshot reference when no change', () => {
      const snap1 = ctrl.getSnapshot()
      const snap2 = ctrl.getSnapshot()
      expect(snap1).toBe(snap2)
    })

    it('returns new snapshot reference on change', () => {
      const snap1 = ctrl.getSnapshot()
      ctrl.setStatus('vibing')
      const snap2 = ctrl.getSnapshot()
      expect(snap1).not.toBe(snap2)
      expect(snap2.status).toBe('vibing')
    })
  })

  // -------------------------------------------------------------------------
  // Queue processing — talk (with TTS)
  // -------------------------------------------------------------------------

  describe('talk queue processing (with TTS)', () => {
    it('sets currentMessage when processing talk item', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      // currentMessage is set synchronously before TTS
      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Hello!' })
    })

    it('calls generateTts with correct params', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()
      expect(deps.generateTts).toHaveBeenCalledWith('Hello!', 'bot')
    })

    it('creates blob URL from TTS result and plays audio', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      expect(deps.createBlobUrl).toHaveBeenCalledWith('AAAA')
      expect(deps._audios[0].url).toBe('blob:mock-AAAA')
      expect(deps._audios[0].volume).toBe(0.8) // openai
      expect(deps._audios[0].play).toHaveBeenCalled()
    })

    it('returns to idle and sends ack after audio ends', async () => {
      ctrl.connect()
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      // Simulate audio ending
      deps._audios[0]._simulateEnd()

      // Post-audio delay timer fires
      timerManager.flushOne()

      expect(ctrl.getSnapshot().currentMessage).toBeNull()
      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
      expect(deps._mockClient.emit).toHaveBeenCalledWith('talk:done', { id: 'talk-1' })
    })

    it('revokes blob URL after audio finishes', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      deps._audios[0]._simulateEnd()
      timerManager.flushOne() // post-audio delay → finishItem

      expect(deps.revokeBlobUrl).toHaveBeenCalledWith('blob:mock-AAAA')
    })

    it('uses tiktok volume when provider is tiktok', async () => {
      deps._ttsResponse = { base64: 'BBBB', provider: 'tiktok' }
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      expect(deps._audios[0].volume).toBe(0.7)
    })

    it('recovers from audio error', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      deps._audios[0]._simulateError()

      // Error delay timer → finishItem
      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })

    it('recovers from play() rejection', async () => {
      deps.createAudio = vi.fn((url: string) => {
        const audio = createMockAudio(url)
        audio.play = vi.fn(() => Promise.reject(new Error('blocked')))
        deps._audios.push(audio)
        return audio as any
      })

      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()
      await flushMicrotasks() // extra flush for play rejection

      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Queue processing — talk (no TTS)
  // -------------------------------------------------------------------------

  describe('talk queue processing (no TTS)', () => {
    beforeEach(() => {
      deps._ttsResponse = null
    })

    it('falls back to text-only delay when generateTts returns null', async () => {
      ctrl.connect()
      ctrl.enqueue({ type: 'talk', id: 'debug-1', text: 'Debug message' })
      await flushMicrotasks()

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Debug message' })
      expect(deps.createAudio).not.toHaveBeenCalled()

      // NO_TTS_DELAY timeout fires → finishItem
      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
      expect(deps._mockClient.emit).toHaveBeenCalledWith('talk:done', { id: 'debug-1' })
    })

    it('falls back to text-only delay when generateTts throws', async () => {
      deps.generateTts = vi.fn(async () => { throw new Error('TTS failed') })
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!' })
      await flushMicrotasks()

      expect(deps.createAudio).not.toHaveBeenCalled()
      // NO_TTS_DELAY timeout fires → finishItem
      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Queue processing — reply-turn
  // -------------------------------------------------------------------------

  describe('reply-turn queue processing', () => {
    const turn = {
      id: 'turn-1',
      chat: { username: 'viewer', message: 'Whats up?' },
      botMessage: 'Not much!',
    }

    it('starts in chat phase with currentTurn set', () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      expect(ctrl.getSnapshot().turnPhase).toBe('chat')
      expect(ctrl.getSnapshot().currentTurn).toBe(turn)
    })

    it('calls generateTts for both chat and bot in parallel', async () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      expect(deps.generateTts).toHaveBeenCalledWith('Whats up?', 'chat')
      expect(deps.generateTts).toHaveBeenCalledWith('Not much!', 'bot')
    })

    it('creates chat audio first', async () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      // First audio is the chat audio
      expect(deps._audios.length).toBeGreaterThanOrEqual(1)
      expect(deps._audios[0].url).toContain('blob:mock-')
    })

    it('transitions to response phase after chat audio ends', async () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      // Chat audio ends
      deps._audios[0]._simulateEnd()

      // Phase transition delay
      timerManager.flushOne()

      expect(ctrl.getSnapshot().turnPhase).toBe('response')
      // Bot audio should be created
      expect(deps._audios.length).toBeGreaterThanOrEqual(2)
    })

    it('completes full turn lifecycle', async () => {
      ctrl.connect()
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      // Chat audio ends
      deps._audios[0]._simulateEnd()
      timerManager.flushOne() // phase transition

      // Response audio ends
      deps._audios[1]._simulateEnd()
      timerManager.flushOne() // post-audio delay → finishItem

      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
      expect(ctrl.getSnapshot().currentTurn).toBeNull()
      expect(deps._mockClient.emit).toHaveBeenCalledWith('talk:done', { id: 'turn-1' })
    })

    it('skips to response phase when no chat TTS', async () => {
      // Only return TTS for bot, null for chat
      let callCount = 0
      deps.generateTts = vi.fn(async (_text: string, voice: 'bot' | 'chat'): Promise<TtsResult> => {
        callCount++
        return voice === 'bot' ? { base64: 'BOT1', provider: 'openai' } : null
      })

      ctrl.connect()
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      // No chat audio — should go straight to response phase
      expect(ctrl.getSnapshot().turnPhase).toBe('response')
      expect(callCount).toBe(2) // both called
    })

    it('handles text-only turn (no TTS for either)', async () => {
      deps._ttsResponse = null
      ctrl.connect()
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      await flushMicrotasks()

      // Should go directly to response phase (no chat TTS)
      // then NO_TTS_DELAY for response
      timerManager.flushOne() // NO_TTS_DELAY → finishItem

      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
      expect(deps._mockClient.emit).toHaveBeenCalledWith('talk:done', { id: 'turn-1' })
    })
  })

  // -------------------------------------------------------------------------
  // Queue serialization
  // -------------------------------------------------------------------------

  describe('queue serialization', () => {
    it('processes items one at a time', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'First' })
      ctrl.enqueue({ type: 'talk', id: 'talk-2', text: 'Second' })

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'First' })
      expect(ctrl.getSnapshot().queueLength).toBe(1)

      await flushMicrotasks()

      // First audio ends
      deps._audios[0]._simulateEnd()
      timerManager.flushOne() // post-audio delay → finishItem

      // Still idle for BUBBLE_GAP
      expect(ctrl.getSnapshot().currentMessage).toBeNull()

      // BUBBLE_GAP timer → processNext
      timerManager.flushOne()
      await flushMicrotasks()

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Second' })
      expect(ctrl.getSnapshot().queueLength).toBe(0)
    })

    it('tracks queueLength correctly', () => {
      deps._ttsResponse = null // no TTS so processing is simpler
      ctrl.enqueue({ type: 'talk', id: '1', text: 'A' })
      // First item is immediately shifted for processing
      expect(ctrl.getSnapshot().queueLength).toBe(0)

      ctrl.enqueue({ type: 'talk', id: '2', text: 'B' })
      expect(ctrl.getSnapshot().queueLength).toBe(1)

      ctrl.enqueue({ type: 'talk', id: '3', text: 'C' })
      expect(ctrl.getSnapshot().queueLength).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Destroy during playback
  // -------------------------------------------------------------------------

  describe('destroy during playback', () => {
    it('pauses audio and clears state', async () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Playing...' })
      await flushMicrotasks()

      expect(deps._audios[0].play).toHaveBeenCalled()

      ctrl.destroy()

      expect(deps._audios[0].pause).toHaveBeenCalled()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
    })

    it('does not process further items after destroy', () => {
      ctrl.destroy()
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Ignored' })
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // showAll
  // -------------------------------------------------------------------------

  describe('showAll', () => {
    it('defaults to false', () => {
      expect(ctrl.getSnapshot().showAll).toBe(false)
    })

    it('can be toggled', () => {
      ctrl.setShowAll(true)
      expect(ctrl.getSnapshot().showAll).toBe(true)

      ctrl.setShowAll(false)
      expect(ctrl.getSnapshot().showAll).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Socket-driven enqueue
  // -------------------------------------------------------------------------

  describe('socket-driven enqueue', () => {
    it('enqueues talk from socket event', () => {
      ctrl.connect()
      deps._mockClient._simulateEvent('talk', {
        id: 'server-talk-1',
        message: 'Hello from server',
      })

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Hello from server' })
    })

    it('enqueues reply-turn from socket event', () => {
      ctrl.connect()
      const turn = {
        id: 'server-turn-1',
        chat: { username: 'user1', message: 'Hi' },
        botMessage: 'Hey!',
      }

      deps._mockClient._simulateEvent('reply-turn', turn)

      expect(ctrl.getSnapshot().turnPhase).toBe('chat')
      expect(ctrl.getSnapshot().currentTurn).toEqual(turn)
    })
  })
})
