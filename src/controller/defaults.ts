import { createCrawdClient } from 'crawd/client'
import type { OverlayControllerDeps } from './types'

export function createDefaultDeps(): OverlayControllerDeps {
  return {
    createClient: createCrawdClient,
    createAudio: (url: string) => {
      const audio = new Audio(url)
      audio.crossOrigin = 'anonymous'
      return audio
    },
    createAudioContext: () => new AudioContext(),
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    setTimeout: (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
    clearTimeout: (id) => window.clearTimeout(id),
  }
}
