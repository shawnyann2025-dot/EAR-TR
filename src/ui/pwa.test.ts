import { describe, expect, it, vi } from 'vitest'
import { createUpdatePort, NO_UPDATES, UPDATE_CHECK_MS, type RegisterSW } from './pwa'

function fakes() {
  let opts: Parameters<RegisterSW>[0] = {}
  const update = vi.fn(async () => {})
  const updateSW = vi.fn(async () => {})
  const register: RegisterSW = (o) => { opts = o; return updateSW }
  const timers: (() => void)[] = []
  const listeners: Record<string, () => void> = {}
  const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (t: string, fn: () => void) => { listeners[t] = fn } }
  const env = { setInterval: ((fn: () => void, ms: number) => { expect(ms).toBe(UPDATE_CHECK_MS); timers.push(fn); return 0 }) as unknown as typeof setInterval, document: doc as never }
  return { register, env, fire: () => opts.onNeedRefresh?.(), registered: () => opts.onRegisteredSW?.('sw.js', { update } as never), update, updateSW, timers, listeners }
}

describe('UpdatePort（P-6 spec §3.3）', () => {
  it('收到新版本：needRefresh 变真并通知订阅者；apply 激活并刷新', async () => {
    const f = fakes()
    const port = createUpdatePort(f.register, f.env)
    const seen = vi.fn()
    port.subscribe(seen)
    expect(port.needRefresh).toBe(false)
    f.fire()
    expect(port.needRefresh).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
    await port.apply()
    expect(f.updateSW).toHaveBeenCalledWith(true)
  })
  it('注册后每 60 分钟、回到前台时各检查一次', () => {
    const f = fakes()
    createUpdatePort(f.register, f.env)
    f.registered()
    expect(f.timers).toHaveLength(1)
    f.timers[0]()
    expect(f.update).toHaveBeenCalledTimes(1)
    f.listeners.visibilitychange()
    expect(f.update).toHaveBeenCalledTimes(2)
  })
  it('退订后不再通知；NO_UPDATES 永远为假', () => {
    const f = fakes()
    const port = createUpdatePort(f.register, f.env)
    const seen = vi.fn()
    port.subscribe(seen)()
    f.fire()
    expect(seen).not.toHaveBeenCalled()
    expect(NO_UPDATES.needRefresh).toBe(false)
  })
})
