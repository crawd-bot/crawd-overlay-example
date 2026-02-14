'use client'

import { useSyncExternalStore } from 'react'
import { OverlayController } from '@/controller/OverlayController'
import { createDefaultDeps } from '@/controller/defaults'
import type { OverlaySnapshot } from '@/controller/types'

// Singleton stored on window so it survives Next.js HMR module re-evaluation.
// Module-level `let` gets reset on every hot reload, leaking socket connections.
const GLOBAL_KEY = '__crawdController' as const

function getController(socketUrl: string): OverlayController {
  const w = globalThis as any
  if (!w[GLOBAL_KEY]) {
    w[GLOBAL_KEY] = new OverlayController(socketUrl, createDefaultDeps())
    w[GLOBAL_KEY].connect()
  }
  return w[GLOBAL_KEY]
}

/**
 * Subscribe to the overlay controller's display state.
 * Re-renders only when snapshot fields change (not on amplitude).
 */
export function useOverlayController(socketUrl: string): {
  controller: OverlayController
  snapshot: OverlaySnapshot
} {
  const controller = getController(socketUrl)

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )

  return { controller, snapshot }
}

/**
 * Subscribe to the amplitude value only.
 * Only the component calling this hook re-renders at ~60fps.
 * Designed for OverlayFace — keeps amplitude updates out of the parent tree.
 */
export function useAmplitude(controller: OverlayController): number {
  return useSyncExternalStore(
    controller.subscribeAmplitude,
    controller.getAmplitude,
  )
}

// For testing: reset the singleton
export function _resetController(): void {
  const w = globalThis as any
  if (w[GLOBAL_KEY]) {
    w[GLOBAL_KEY].destroy()
    delete w[GLOBAL_KEY]
  }
}
