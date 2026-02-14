import { createCrawdClient } from 'crawd/client'
import { generateTts } from '@/lib/tts/generate'
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
    generateTts,
    createBlobUrl: (base64: string) => {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      return URL.createObjectURL(blob)
    },
    revokeBlobUrl: (url: string) => URL.revokeObjectURL(url),
  }
}
