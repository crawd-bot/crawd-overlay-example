let client: any = null

async function getClient(): Promise<any> {
  if (!client) {
    // @ts-expect-error — optional dependency, may not be installed
    const { ElevenLabsClient } = await import(/* webpackIgnore: true */ '@elevenlabs/elevenlabs-js')
    client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
  }
  return client
}

export async function generateElevenLabsTTS(text: string, voiceId: string): Promise<Buffer> {
  const elevenlabs = await getClient()

  const audio = await elevenlabs.textToSpeech.convert(voiceId, {
    modelId: 'eleven_multilingual_v2',
    text,
    outputFormat: 'mp3_44100_128',
    voiceSettings: {
      stability: 0,
      similarityBoost: 1.0,
      useSpeakerBoost: true,
      speed: 1.0,
    },
  })

  const response = new Response(audio as any)
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Check if response is valid MP3
  const isMP3 =
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)

  if (!isMP3) {
    const preview = buffer.subarray(0, 200).toString('utf-8')
    throw new Error(`ElevenLabs returned non-audio response: ${preview.slice(0, 100)}`)
  }

  return buffer
}
