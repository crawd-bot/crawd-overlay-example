import { useRef, useState, useCallback, useEffect } from "react"

type AudioAnalysisResult = {
  amplitude: number
  isPlaying: boolean
  connectAudio: (audio: HTMLAudioElement) => void
  disconnect: () => void
}

export function useAudioAnalysis(): AudioAnalysisResult {
  const [amplitude, setAmplitude] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const connectedAudioRef = useRef<HTMLAudioElement | null>(null)

  const analyze = useCallback(() => {
    if (!analyserRef.current) return

    const analyser = analyserRef.current
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray)

      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / dataArray.length)
      const scaledAmplitude = Math.min(1, rms * 3)
      setAmplitude(scaledAmplitude)

      animationFrameRef.current = requestAnimationFrame(tick)
    }

    tick()
  }, [])

  const connectAudio = useCallback((audio: HTMLAudioElement) => {
    if (connectedAudioRef.current === audio) return

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    const ctx = audioContextRef.current

    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
    }

    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser()
      analyserRef.current.fftSize = 256
      analyserRef.current.connect(ctx.destination)
    }

    try {
      sourceRef.current = ctx.createMediaElementSource(audio)
      sourceRef.current.connect(analyserRef.current)
      connectedAudioRef.current = audio
    } catch (e) {
      console.warn('Could not connect audio element:', e)
    }

    setIsPlaying(true)
    analyze()

    const stop = () => {
      setIsPlaying(false)
      setAmplitude(0)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }

    audio.addEventListener('ended', stop)
    audio.addEventListener('pause', stop)
    audio.addEventListener('play', () => { setIsPlaying(true); analyze() })
  }, [analyze])

  const disconnect = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    setIsPlaying(false)
    setAmplitude(0)
  }, [])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [])

  return { amplitude, isPlaying, connectAudio, disconnect }
}
