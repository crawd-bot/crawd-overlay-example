import OpenAI from 'openai'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

export async function generateOpenAITTS(text: string, voice: string): Promise<Buffer> {
  const openai = getClient()

  const response = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: voice as 'onyx',
    input: text,
  })

  return Buffer.from(await response.arrayBuffer())
}
