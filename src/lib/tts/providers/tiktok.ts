/**
 * TikTok Text-to-Speech
 * Vendored from https://github.com/Steve0929/tiktok-tts
 * Converted to TypeScript/ESM with native fetch
 */

const DEFAULT_BASE_URL = 'https://api16-normal-v6.tiktokv.com/media/api/text/speech/invoke'
const DEFAULT_VOICE = 'en_us_002' // Jessie

function prepareText(text: string): string {
  return text
    .replace(/\+/g, 'plus')
    .replace(/\s/g, '+')
    .replace(/&/g, 'and')
}

function handleStatusError(statusCode: number): never {
  switch (statusCode) {
    case 1:
      throw new Error(`TikTok session id invalid or expired. status_code: ${statusCode}`)
    case 2:
      throw new Error(`Text is too long. status_code: ${statusCode}`)
    case 4:
      throw new Error(`Invalid speaker voice. status_code: ${statusCode}`)
    case 5:
      throw new Error(`No session id found. status_code: ${statusCode}`)
    default:
      throw new Error(`TikTok TTS error. status_code: ${statusCode}`)
  }
}

type TikTokResponse = {
  status_code: number
  data?: {
    v_str?: string
  }
}

export async function generateTikTokTTS(
  text: string,
  voice: string = DEFAULT_VOICE,
  sessionId?: string,
): Promise<Buffer> {
  const sid = sessionId ?? process.env.TIKTOK_SESSION_ID
  if (!sid) {
    throw new Error('TikTok TTS not configured (missing TIKTOK_SESSION_ID)')
  }

  const reqText = prepareText(text)
  const url = `${DEFAULT_BASE_URL}/?text_speaker=${voice}&req_text=${reqText}&speaker_map_type=0&aid=1233`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)',
      'Cookie': `sessionid=${sid}`,
      'Accept-Encoding': 'gzip,deflate,compress',
    },
  })

  if (!response.ok) {
    throw new Error(`TikTok TTS request failed: ${response.status} ${response.statusText}`)
  }

  const result = (await response.json()) as TikTokResponse

  if (result.status_code !== 0) {
    handleStatusError(result.status_code)
  }

  const encodedVoice = result.data?.v_str
  if (!encodedVoice) {
    throw new Error('TikTok TTS returned no audio data')
  }

  return Buffer.from(encodedVoice, 'base64')
}
