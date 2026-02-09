import { useSyncExternalStore } from 'react'
import { OverlayController } from '../controller/OverlayController'
import { createDefaultDeps } from '../controller/defaults'
import type { OverlaySnapshot } from '../controller/types'

// Module-level singleton — survives React strict-mode double-mount,
// completely decoupled from React lifecycle. Appropriate for an OBS
// browser source where only one overlay instance ever exists.
let _controller: OverlayController | null = null

function getController(socketUrl: string): OverlayController {
  if (!_controller) {
    _controller = new OverlayController(socketUrl, createDefaultDeps())
    _controller.connect()
  }
  return _controller
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
  if (_controller) {
    _controller.destroy()
    _controller = null
  }
}
