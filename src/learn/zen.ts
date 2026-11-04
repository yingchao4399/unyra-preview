import { useSyncExternalStore } from 'react'

/**
 * 纯净阅读模式（Zen mode）全局状态管理。
 *
 * 供排版容器、可拖拽虚线边框等组件跨层感知纯净阅读状态，
 * 避免在 LearnWorkspace -> DocPane -> NodeNote -> DocBody 间深层透传 props。
 */

const listeners = new Set<() => void>()

export function setZenActive(active: boolean): void {
  if (typeof document === 'undefined') return
  const prev = document.documentElement.getAttribute('data-zen') === 'true'
  if (prev !== active) {
    if (active) {
      document.documentElement.setAttribute('data-zen', 'true')
    } else {
      document.documentElement.removeAttribute('data-zen')
    }
    listeners.forEach((fn) => fn())
  }
}

export function isZenActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-zen') === 'true'
}

export function subscribeZen(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useZenMode(): boolean {
  return useSyncExternalStore(subscribeZen, isZenActive, () => false)
}
