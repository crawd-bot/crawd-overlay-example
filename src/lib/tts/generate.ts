'use server'

import type { TtsProvider } from './types'

type TtsResult = { base64: string; provider: string } | null

function getProviderConfig(voice: 'bot' | 'chat'): { provider: TtsProvider; voiceId: string } | null {
  const prefix = voice === 'bot' ? 'TTS_BOT' : 'TTS_CHAT'
  const provider = process.env[`${prefix}_PROVIDER`] as TtsProvider | undefined
  const voiceId = process.env[`${prefix}_VOICE`]

  if (!provider) return null

  // Default voices per provider
  const defaultVoices: Record<TtsProvider, string> = {
    openai: 'onyx',
    elevenlabs: 'TX3LPaxmHKxFdv7VOQHJ',
    tiktok: 'en_us_002',
  }

  return { provider, voiceId: voiceId || defaultVoices[provider] }
}

async function generateWithProvider(text: string, provider: TtsProvider, voiceId: string): Promise<Buffer> {
  switch (provider) {
    case 'openai': {
      const { generateOpenAITTS } = await import('./providers/openai')
      return generateOpenAITTS(text, voiceId)
    }
    case 'elevenlabs': {
      const { generateElevenLabsTTS } = await import('./providers/elevenlabs')
      return generateElevenLabsTTS(text, voiceId)
    }
    case 'tiktok': {
      const { generateTikTokTTS } = await import('./providers/tiktok')
      return generateTikTokTTS(text, voiceId)
    }
  }
}

export async function generateTts(text: string, voice: 'bot' | 'chat'): Promise<TtsResult> {
  const config = getProviderConfig(voice)
  if (!config) return null

  const textToSpeak = voice === 'bot' ? text : `Chat says: ${text}`

  try {
    const buffer = await generateWithProvider(textToSpeak, config.provider, config.voiceId)
    return { base64: buffer.toString('base64'), provider: config.provider }
  } catch (e) {
    console.error(`TTS generation failed (${config.provider}/${config.voiceId}):`, e)
    return null
  }
}
