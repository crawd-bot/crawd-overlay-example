export type TtsProvider = 'openai' | 'elevenlabs' | 'tiktok'

export type TtsResult = {
  base64: string
  provider: TtsProvider
}

export type TtsVoiceConfig = {
  provider: TtsProvider
  voice: string
}
