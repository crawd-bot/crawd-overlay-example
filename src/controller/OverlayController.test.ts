import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OverlayController, volumeForProvider } from './OverlayController'
import type { OverlayControllerDeps } from './types'

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
      // Fire pause listeners
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
}

function createMockDeps(): MockDeps {
  const mockClient = createMockClient()
  const audios: MockAudio[] = []

  return {
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
      // Return a unique id but don't auto-fire — tests call flush manually
      return timerManager.register(cb)
    }),
    clearTimeout: vi.fn((id) => {
      timerManager.cancel(id)
    }),
    _mockClient: mockClient,
    _audios: audios,
  }
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
    // Fire all pending timers (snapshot to avoid mutation during iteration)
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
  // Queue processing — talk
  // -------------------------------------------------------------------------

  describe('talk queue processing', () => {
    it('sets currentMessage when processing talk item', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3' })
      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Hello!' })
    })

    it('creates audio with correct URL and volume', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3', ttsProvider: 'tiktok' })
      expect(deps.createAudio).toHaveBeenCalledWith('http://audio/1.mp3')
      expect(deps._audios[0].volume).toBe(0.7)
    })

    it('plays audio', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3' })
      expect(deps._audios[0].play).toHaveBeenCalled()
    })

    it('returns to idle and sends ack after audio ends', () => {
      ctrl.connect()
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3' })

      // Simulate audio ending
      deps._audios[0]._simulateEnd()

      // Post-audio delay timer fires
      timerManager.flushOne()

      expect(ctrl.getSnapshot().currentMessage).toBeNull()
      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
      expect(deps._mockClient.emit).toHaveBeenCalledWith('talk:done', { id: 'talk-1' })
    })

    it('handles talk with no ttsUrl (debug mode)', () => {
      ctrl.enqueue({ type: 'talk', id: 'debug-1', text: 'Debug message', ttsUrl: '' })
      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Debug message' })
      expect(deps.createAudio).not.toHaveBeenCalled()

      // NO_TTS_DELAY timeout fires → finishItem
      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })

    it('recovers from audio error', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3' })
      deps._audios[0]._simulateError()

      // Error delay timer → finishItem
      timerManager.flushOne()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
    })

    it('recovers from play() rejection', () => {
      // Override play to reject
      deps.createAudio = vi.fn((url: string) => {
        const audio = createMockAudio(url)
        audio.play = vi.fn(() => Promise.reject(new Error('blocked')))
        deps._audios.push(audio)
        return audio as any
      })

      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Hello!', ttsUrl: 'http://audio/1.mp3' })

      // play() rejection schedules error delay → flush microtasks then timer
      return Promise.resolve().then(() => {
        timerManager.flushOne()
        expect(ctrl.getSnapshot().currentMessage).toBeNull()
      })
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
      chatTtsUrl: 'http://audio/chat.mp3',
      botTtsUrl: 'http://audio/bot.mp3',
      chatTtsProvider: 'tiktok' as const,
      botTtsProvider: 'openai' as const,
    }

    it('starts in chat phase with currentTurn set', () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      expect(ctrl.getSnapshot().turnPhase).toBe('chat')
      expect(ctrl.getSnapshot().currentTurn).toBe(turn)
    })

    it('creates chat audio with correct volume', () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })
      expect(deps._audios[0].url).toBe('http://audio/chat.mp3')
      expect(deps._audios[0].volume).toBe(0.7) // tiktok
    })

    it('transitions to response phase after chat audio ends', () => {
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })

      // Chat audio ends
      deps._audios[0]._simulateEnd()

      // Phase transition delay
      timerManager.flushOne()

      expect(ctrl.getSnapshot().turnPhase).toBe('response')
      // Bot audio should be created
      expect(deps._audios[1].url).toBe('http://audio/bot.mp3')
      expect(deps._audios[1].volume).toBe(0.8) // openai
    })

    it('completes full turn lifecycle', () => {
      ctrl.connect()
      ctrl.enqueue({ type: 'reply-turn', id: 'turn-1', turn })

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
  })

  // -------------------------------------------------------------------------
  // Queue serialization
  // -------------------------------------------------------------------------

  describe('queue serialization', () => {
    it('processes items one at a time', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'First', ttsUrl: 'http://audio/1.mp3' })
      ctrl.enqueue({ type: 'talk', id: 'talk-2', text: 'Second', ttsUrl: 'http://audio/2.mp3' })

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'First' })
      expect(ctrl.getSnapshot().queueLength).toBe(1)

      // First audio ends
      deps._audios[0]._simulateEnd()
      timerManager.flushOne() // post-audio delay → finishItem

      // Still idle for BUBBLE_GAP
      expect(ctrl.getSnapshot().currentMessage).toBeNull()

      // BUBBLE_GAP timer → processNext
      timerManager.flushOne()

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Second' })
      expect(ctrl.getSnapshot().queueLength).toBe(0)
    })

    it('tracks queueLength correctly', () => {
      expect(ctrl.getSnapshot().queueLength).toBe(0)

      ctrl.enqueue({ type: 'talk', id: '1', text: 'A', ttsUrl: '' })
      // First item is immediately shifted for processing
      expect(ctrl.getSnapshot().queueLength).toBe(0)

      ctrl.enqueue({ type: 'talk', id: '2', text: 'B', ttsUrl: '' })
      expect(ctrl.getSnapshot().queueLength).toBe(1)

      ctrl.enqueue({ type: 'talk', id: '3', text: 'C', ttsUrl: '' })
      expect(ctrl.getSnapshot().queueLength).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Destroy during playback
  // -------------------------------------------------------------------------

  describe('destroy during playback', () => {
    it('pauses audio and clears state', () => {
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Playing...', ttsUrl: 'http://audio/1.mp3' })
      expect(deps._audios[0].play).toHaveBeenCalled()

      ctrl.destroy()

      expect(deps._audios[0].pause).toHaveBeenCalled()
      expect(ctrl.getSnapshot().currentMessage).toBeNull()
      expect(ctrl.getSnapshot().turnPhase).toBe('idle')
    })

    it('does not process further items after destroy', () => {
      ctrl.destroy()
      ctrl.enqueue({ type: 'talk', id: 'talk-1', text: 'Ignored', ttsUrl: '' })
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
        ttsUrl: 'http://audio/server.mp3',
        ttsProvider: 'openai',
      })

      expect(ctrl.getSnapshot().currentMessage).toEqual({ text: 'Hello from server' })
    })

    it('enqueues reply-turn from socket event', () => {
      ctrl.connect()
      const turn = {
        id: 'server-turn-1',
        chat: { username: 'user1', message: 'Hi' },
        botMessage: 'Hey!',
        chatTtsUrl: 'http://audio/chat.mp3',
        botTtsUrl: 'http://audio/bot.mp3',
      }

      deps._mockClient._simulateEvent('reply-turn', turn)

      expect(ctrl.getSnapshot().turnPhase).toBe('chat')
      expect(ctrl.getSnapshot().currentTurn).toEqual(turn)
    })
  })
})
