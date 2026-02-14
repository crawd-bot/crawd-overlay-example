'use client'

import { useEffect, useState, useRef, memo } from "react"
import { motion, AnimatePresence } from "motion/react"
import type { OverlayController } from "@/controller/OverlayController"
import { useAmplitude } from "@/hooks/useOverlayController"

type FaceStatus = 'sleep' | 'idle' | 'vibing' | 'chatting' | 'active'

type OverlayFaceProps = {
  status?: FaceStatus
  controller: OverlayController
}

type ZLetter = { id: number; size: 'large' | 'medium' | 'small' }

function useAutonomousGaze(enabled: boolean) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!enabled) { setOffset({ x: 0, y: 0 }); return }

    const look = () => {
      setOffset({ x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 10 })
    }

    const scheduleNext = () => {
      const delay = 800 + Math.random() * 2500
      return setTimeout(() => { look(); timerId = scheduleNext() }, delay)
    }

    let timerId = scheduleNext()
    return () => clearTimeout(timerId)
  }, [enabled])

  return offset
}

const Z_SIZES = ['large', 'medium', 'small'] as const

export const OverlayFace = memo(function OverlayFace({ status = 'active', controller }: OverlayFaceProps) {
  const audioAmplitude = useAmplitude(controller)
  const isSleeping = status === 'sleep'
  const isTalking = audioAmplitude > 0.05
  const [blinking, setBlinking] = useState(false)
  const [zLetters, setZLetters] = useState<ZLetter[]>([])
  const zIdRef = useRef(0)
  const offset = useAutonomousGaze(!isSleeping)

  useEffect(() => {
    if (isSleeping) return
    const blink = () => { setBlinking(true); setTimeout(() => setBlinking(false), 150) }
    const scheduleNextBlink = () => {
      const delay = 2000 + Math.random() * 4000
      return setTimeout(() => { blink(); timerId = scheduleNextBlink() }, delay)
    }
    let timerId = scheduleNextBlink()
    return () => clearTimeout(timerId)
  }, [isSleeping])

  const floatDuration = isSleeping ? 6 : 2
  const zAnimDuration = 3

  useEffect(() => {
    if (!isSleeping) { setZLetters([]); return }

    const spawnCycle = () => {
      Z_SIZES.forEach((size, i) => {
        setTimeout(() => {
          const id = zIdRef.current++
          setZLetters(prev => [...prev, { id, size }])
          setTimeout(() => setZLetters(prev => prev.filter(z => z.id !== id)), zAnimDuration * 1000)
        }, i * 200)
      })
    }

    const firstSpawnTimer = setTimeout(() => {
      spawnCycle()
      interval = setInterval(spawnCycle, floatDuration * 1000)
    }, (floatDuration * 1000) / 2)

    let interval: ReturnType<typeof setInterval>
    return () => { clearTimeout(firstSpawnTimer); if (interval) clearInterval(interval) }
  }, [isSleeping, floatDuration])

  const scaleY = isSleeping ? 0.08 : (blinking ? 0.05 : 1)
  const shadowX = -offset.x * 1.5
  const shadowY = -offset.y * 1.5
  const floatAmplitude = isSleeping ? -12 : -6

  const getZFontSize = (size: ZLetter['size']) =>
    size === 'large' ? '2rem' : size === 'medium' ? '1.5rem' : '1rem'

  return (
    <motion.div
      className="relative"
      animate={{ y: [0, floatAmplitude, 0] }}
      transition={{ duration: floatDuration, ease: "easeInOut", repeat: Infinity }}
    >
      <div className="flex flex-col shrink-0 corner-squircle rounded-[30%] w-[200px] h-[200px] items-center justify-center bg-gradient-to-br from-[#FBA875] to-[#E67732]">
        <div className="flex justify-center gap-6 mb-3.5">
          {[0, 1].map(i => (
            <motion.div
              key={i}
              className="rounded-sm bg-gradient-to-b from-black to-[#303030]"
              style={{ width: 36, height: 50 }}
              animate={{
                x: offset.x, y: offset.y, scaleY,
                boxShadow: `${shadowX}px ${shadowY}px 12px 2px rgba(0, 0, 0, 0.12)`,
              }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          ))}
        </div>
        <div className="flex justify-center">
          <motion.div
            className="bg-gradient-to-b from-black to-[#303030]"
            animate={isSleeping ? {
              width: [11, 11, 16, 11], height: [5, 5, 14, 5],
              borderRadius: ['2px', '2px', '50%', '2px'],
            } : isTalking ? {
              width: 12 + audioAmplitude * 16, height: 6 + audioAmplitude * 44,
              borderRadius: audioAmplitude > 0.15 ? '50%' : '4px',
            } : { width: 11, height: 5, borderRadius: '2px' }}
            transition={isSleeping ? {
              duration: floatDuration, ease: "easeInOut", repeat: Infinity,
              times: [0, 0.5, 0.6, 1],
            } : { duration: 0.05, ease: "easeOut" }}
          />
        </div>
      </div>

      <AnimatePresence>
        {zLetters.map(z => (
          <motion.div
            key={z.id}
            className="absolute text-white select-none pointer-events-none"
            style={{
              fontFamily: '"SF Pro Rounded", sans-serif', fontWeight: 900,
              WebkitTextStroke: "4px black", paintOrder: "stroke fill",
              fontSize: getZFontSize(z.size), left: '50%', bottom: '35%',
            }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
            animate={{
              opacity: [0, 1, 1, 0], x: [0, 20, 50, 80],
              y: [0, -40, -90, -140], scale: [0.5, 1, 1, 0.8],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: zAnimDuration, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
          >
            Z
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  )
})
