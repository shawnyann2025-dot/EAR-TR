import { useEffect, useRef } from 'react'
import type { LazyAudio } from './platform'

interface WakeLockSentinelLike {
  release(): Promise<void>
}

/** 练习中保持亮屏（P-3 spec §6.6）。不支持的浏览器静默跳过 */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null)
  useEffect(() => {
    const wl = (navigator as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock
    if (!active || !wl) return
    let alive = true
    const acquire = () => {
      wl.request('screen').then(
        (s) => {
          if (alive) {
            const prev = sentinel.current
            sentinel.current = s
            if (prev && prev !== s) void prev.release().catch(() => {})
          } else void s.release().catch(() => {})
        },
        () => {},
      )
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      const s = sentinel.current
      sentinel.current = null
      if (s) void s.release().catch(() => {})
    }
  }, [active])
}

/** 页面隐藏或音频被系统挂起 → 中断（主 spec §11、P-3 spec §6.6） */
export function useInterruptions(opts: { active: boolean; audio: Pick<LazyAudio, 'onStateChange' | 'state'>; onInterrupt: () => void }): void {
  const cb = useRef(opts.onInterrupt)
  cb.current = opts.onInterrupt
  const { active, audio } = opts
  useEffect(() => {
    if (!active) return
    // 激活时立即检查：反馈期间可能已经切走或被系统挂起
    if (document.visibilityState === 'hidden' || (audio.state !== 'none' && audio.state !== 'running')) cb.current()
    const onVis = () => {
      if (document.visibilityState === 'hidden') cb.current()
    }
    document.addEventListener('visibilitychange', onVis)
    const off = audio.onStateChange((s) => {
      if (s !== 'running') cb.current()
    })
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      off()
    }
  }, [active, audio])
}
