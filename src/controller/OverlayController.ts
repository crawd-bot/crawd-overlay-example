import type { CrawdClient } from 'crawd/client'
import type {
  OverlayControllerDeps,
  OverlaySnapshot,
  OverlayStatus,
  QueueItem,
  TtsResult,
} from './types'

/** Per-provider volume levels (0–1). TikTok is louder than other providers. */
const PROVIDER_VOLUME: Record<string, number> = { tiktok: 0.7 }
const DEFAULT_VOLUME = 0.8
const BUBBLE_GAP_MS = 1500
const POST_AUDIO_DELAY_MS = 1500
const ERROR_DELAY_MS = 3000
const NO_TTS_DELAY_MS = 3000
const MAX_AUDIO_TIMEOUT_MS = 30_000
const PHASE_TRANSITION_DELAY_MS = 500
const CHAT_PHASE_TIMEOUT_MS = 15_000

export function volumeForProvider(provider?: string): number {
  return provider ? (PROVIDER_VOLUME[provider] ?? DEFAULT_VOLUME) : DEFAULT_VOLUME
}

function initialSnapshot(): OverlaySnapshot {
  return {
    connected: false,
    status: 'sleep',
    turnPhase: 'idle',
    currentTurn: null,
    currentMessage: null,
    queueLength: 0,
    showAll: false,
  }
}

export class OverlayController {
  private _snapshot: OverlaySnapshot = initialSnapshot()
  private _amplitude = 0

  private _listeners = new Set<() => void>()
  private _amplitudeListeners = new Set<() => void>()

  private _client: CrawdClient | null = null
  private _queue: QueueItem[] = []
  private _processing = false
  private _audio: HTMLAudioElement | null = null
  private _timer: number | null = null
  private _destroyed = false

  // Audio analysis
  private _audioCtx: AudioContext | null = null
  private _analyser: AnalyserNode | null = null
  private _source: MediaElementAudioSourceNode | null = null
  private _connectedAudioEl: HTMLAudioElement | null = null
  private _rafId: number | null = null
  private _audioStopHandler: (() => void) | null = null
  private _audioPlayHandler: (() => void) | null = null

  constructor(
    private readonly _socketUrl: string,
    private readonly _deps: OverlayControllerDeps,
  ) {}

  // ---------------------------------------------------------------------------
  // Subscription API (for useSyncExternalStore)
  // ---------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  getSnapshot = (): OverlaySnapshot => {
    return this._snapshot
  }

  subscribeAmplitude = (listener: () => void): (() => void) => {
    this._amplitudeListeners.add(listener)
    return () => { this._amplitudeListeners.delete(listener) }
  }

  getAmplitude = (): number => {
    return this._amplitude
  }

  // ---------------------------------------------------------------------------
  // Snapshot mutation
  // ---------------------------------------------------------------------------

  private _emit(): void {
    for (const fn of this._listeners) fn()
  }

  private _set<K extends keyof OverlaySnapshot>(key: K, value: OverlaySnapshot[K]): void {
    if (this._snapshot[key] === value) return
    this._snapshot = { ...this._snapshot, [key]: value }
    this._emit()
  }

  private _setBatch(updates: Partial<OverlaySnapshot>): void {
    let changed = false
    for (const key of Object.keys(updates) as (keyof OverlaySnapshot)[]) {
      if (this._snapshot[key] !== updates[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this._snapshot = { ...this._snapshot, ...updates }
    this._emit()
  }

  private _emitAmplitude(): void {
    for (const fn of this._amplitudeListeners) fn()
  }

  // ---------------------------------------------------------------------------
  // Socket lifecycle
  // ---------------------------------------------------------------------------

  connect(): void {
    if (this._client || this._destroyed) return

    this._client = this._deps.createClient(this._socketUrl)

    this._client.on('connect', () => { this._set('connected', true) })
    this._client.on('disconnect', () => { this._set('connected', false) })

    this._client.on('status', (data) => {
      this._set('status', data.status as OverlayStatus)
    })

    this._client.on('talk', (data) => {
      this.enqueue({
        type: 'talk',
        id: data.id,
        text: data.message,
      })
    })

    this._client.on('reply-turn', (data) => {
      this.enqueue({ type: 'reply-turn', id: data.id, turn: data })
    })
  }

  destroy(): void {
    this._destroyed = true
    this._clearTimer()
    this._stopAudio()
    this._disconnectAnalysis()
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {})
      this._audioCtx = null
    }
    this._client?.destroy()
    this._client = null
    this._queue.length = 0
    this._processing = false
    this._setBatch({
      connected: false,
      turnPhase: 'idle',
      currentTurn: null,
      currentMessage: null,
      queueLength: 0,
    })
  }

  // ---------------------------------------------------------------------------
  // Public methods (for debug panel)
  // ---------------------------------------------------------------------------

  enqueue(item: QueueItem): void {
    if (this._destroyed) return
    this._queue.push(item)
    this._set('queueLength', this._queue.length)
    if (!this._processing) this._processNext()
  }

  setStatus(status: OverlayStatus): void {
    this._set('status', status)
  }

  setShowAll(showAll: boolean): void {
    this._set('showAll', showAll)
  }

  // ---------------------------------------------------------------------------
  // Queue processing
  // ---------------------------------------------------------------------------

  private _processNext(): void {
    if (this._destroyed || this._queue.length === 0) {
      this._processing = false
      return
    }

    this._processing = true
    const item = this._queue.shift()!
    this._set('queueLength', this._queue.length)

    if (item.type === 'talk') {
      this._processTalk(item)
    } else {
      this._processReplyTurn(item)
    }
  }

  private async _processTalk(item: QueueItem & { type: 'talk' }): Promise<void> {
    this._set('currentMessage', { text: item.text })

    const finish = () => this._finishItem(item.id)

    let ttsResult: TtsResult = null
    try {
      ttsResult = await this._deps.generateTts(item.text, 'bot')
    } catch {
      // TTS generation failed — fall through to text-only mode
    }

    if (this._destroyed) return

    if (ttsResult) {
      const blobUrl = this._deps.createBlobUrl(ttsResult.base64)
      this._playAudio(blobUrl, ttsResult.provider, () => {
        this._deps.revokeBlobUrl(blobUrl)
        finish()
      })
    } else {
      this._timer = this._deps.setTimeout(finish, NO_TTS_DELAY_MS)
    }
  }

  private async _processReplyTurn(item: QueueItem & { type: 'reply-turn' }): Promise<void> {
    const { turn } = item

    this._setBatch({ currentTurn: turn, turnPhase: 'chat' })

    let chatTts: TtsResult = null
    let botTts: TtsResult = null
    try {
      ;[chatTts, botTts] = await Promise.all([
        this._deps.generateTts(turn.chat.message, 'chat'),
        this._deps.generateTts(turn.botMessage, 'bot'),
      ])
    } catch {
      // TTS generation failed
    }

    if (this._destroyed) return

    const finishTurn = () => this._finishItem(item.id)

    const startResponsePhase = () => {
      this._clearTimer()
      this._set('turnPhase', 'response')

      if (botTts) {
        const botBlobUrl = this._deps.createBlobUrl(botTts.base64)
        this._playAudio(botBlobUrl, botTts.provider, () => {
          this._deps.revokeBlobUrl(botBlobUrl)
          finishTurn()
        })
      } else {
        this._timer = this._deps.setTimeout(finishTurn, NO_TTS_DELAY_MS)
      }
    }

    if (chatTts) {
      // Phase 1: play chat audio
      const chatBlobUrl = this._deps.createBlobUrl(chatTts.base64)
      this._stopAudio()
      const chatAudio = this._deps.createAudio(chatBlobUrl)
      chatAudio.volume = volumeForProvider(chatTts.provider)
      this._audio = chatAudio

      const onChatEnd = () => {
        this._deps.revokeBlobUrl(chatBlobUrl)
        this._clearTimer()
        this._timer = this._deps.setTimeout(startResponsePhase, PHASE_TRANSITION_DELAY_MS)
      }

      chatAudio.onended = onChatEnd
      chatAudio.onerror = onChatEnd
      chatAudio.play().catch(onChatEnd)

      // Safety timeout for chat phase
      this._timer = this._deps.setTimeout(startResponsePhase, CHAT_PHASE_TIMEOUT_MS)
    } else {
      // No chat TTS — go straight to response phase
      startResponsePhase()
    }
  }

  private _playAudio(url: string, provider: string | undefined, onFinish: () => void): void {
    this._stopAudio()
    const audio = this._deps.createAudio(url)
    audio.volume = volumeForProvider(provider)
    this._audio = audio
    this._connectAnalysis(audio)

    const done = () => {
      this._clearTimer()
      this._timer = this._deps.setTimeout(onFinish, POST_AUDIO_DELAY_MS)
    }
    const fail = () => {
      this._clearTimer()
      this._timer = this._deps.setTimeout(onFinish, ERROR_DELAY_MS)
    }

    audio.onended = done
    audio.onerror = fail
    audio.play().catch(fail)

    // Safety timeout
    this._timer = this._deps.setTimeout(onFinish, MAX_AUDIO_TIMEOUT_MS)
  }

  private _finishItem(id: string): void {
    this._clearTimer()
    this._stopAudio()
    this._disconnectAnalysis()

    this._setBatch({
      turnPhase: 'idle',
      currentTurn: null,
      currentMessage: null,
    })

    this._sendAck(id)
    this._timer = this._deps.setTimeout(() => this._processNext(), BUBBLE_GAP_MS)
  }

  private _sendAck(id: string): void {
    this._client?.emit('talk:done', { id })
  }

  // ---------------------------------------------------------------------------
  // Audio element management
  // ---------------------------------------------------------------------------

  private _stopAudio(): void {
    if (this._audio) {
      this._audio.onended = null
      this._audio.onerror = null
      this._audio.pause()
      this._audio = null
    }
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      this._deps.clearTimeout(this._timer)
      this._timer = null
    }
  }

  // ---------------------------------------------------------------------------
  // Audio analysis (amplitude for mouth animation)
  // ---------------------------------------------------------------------------

  private _connectAnalysis(audio: HTMLAudioElement): void {
    if (this._connectedAudioEl === audio) return

    // Clean up old listeners
    this._removeAudioListeners()

    // Lazy-init AudioContext
    if (!this._audioCtx) {
      this._audioCtx = this._deps.createAudioContext()
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume().catch(() => {})
    }

    // Disconnect old source
    if (this._source) {
      this._source.disconnect()
      this._source = null
    }

    // Create analyser if needed
    if (!this._analyser) {
      this._analyser = this._audioCtx.createAnalyser()
      this._analyser.fftSize = 256
      this._analyser.connect(this._audioCtx.destination)
    }

    // Connect new source
    try {
      this._source = this._audioCtx.createMediaElementSource(audio)
      this._source.connect(this._analyser)
      this._connectedAudioEl = audio
    } catch {
      return
    }

    // Start amplitude loop
    this._startAmplitudeLoop()

    // Wire stop/play listeners (with proper cleanup refs)
    const stopHandler = () => {
      this._stopAmplitudeLoop()
      this._amplitude = 0
      this._emitAmplitude()
    }
    const playHandler = () => {
      this._startAmplitudeLoop()
    }

    this._audioStopHandler = stopHandler
    this._audioPlayHandler = playHandler

    audio.addEventListener('ended', stopHandler)
    audio.addEventListener('pause', stopHandler)
    audio.addEventListener('play', playHandler)
  }

  private _disconnectAnalysis(): void {
    this._removeAudioListeners()
    this._stopAmplitudeLoop()
    if (this._source) {
      this._source.disconnect()
      this._source = null
    }
    this._connectedAudioEl = null
    this._amplitude = 0
    this._emitAmplitude()
  }

  private _removeAudioListeners(): void {
    if (this._connectedAudioEl && this._audioStopHandler && this._audioPlayHandler) {
      this._connectedAudioEl.removeEventListener('ended', this._audioStopHandler)
      this._connectedAudioEl.removeEventListener('pause', this._audioStopHandler)
      this._connectedAudioEl.removeEventListener('play', this._audioPlayHandler)
    }
    this._audioStopHandler = null
    this._audioPlayHandler = null
  }

  private _startAmplitudeLoop(): void {
    this._stopAmplitudeLoop()
    if (!this._analyser) return

    const analyser = this._analyser
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray)

      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / dataArray.length)
      this._amplitude = Math.min(1, rms * 3)
      this._emitAmplitude()

      this._rafId = this._deps.requestAnimationFrame(tick)
    }

    tick()
  }

  private _stopAmplitudeLoop(): void {
    if (this._rafId !== null) {
      this._deps.cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }
}
