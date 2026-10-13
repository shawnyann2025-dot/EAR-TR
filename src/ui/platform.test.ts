import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioEngine } from '../audio/AudioEngine'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError } from '../storage/types'
import { MicError, type MicSession } from '../audio/micCapture'
import { boot, createLazyAudio, createLazyMic, newId, type LazyAudio } from './platform'

const fixedNow = () => new Date(2026, 9, 13, 9, 0)

describe('boot', () => {
  it('正常：拿到 runtime，没有警告', async () => {
    const r = await boot({ openRepo: async () => new MemoryRepository(), now: fixedNow, randomId: () => 'p1' })
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    expect(r.storageWarning).toBeNull()
    expect((await r.runtime.ensureProfile()).createdAtLocalDate).toBe('2026-10-13')
  })

  it('IndexedDB 不可用：降级为内存仓库并给出警告', async () => {
    const r = await boot({ openRepo: async () => { throw new StorageUnavailableError('无') }, now: fixedNow, randomId: () => 'p1' })
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') expect(r.storageWarning).toMatch(/不会保存/)
  })

  it('数据损坏：给出原始数据；rebuild 删库后重新打开', async () => {
    let opens = 0
    const deleteDb = vi.fn(async () => {})
    const r = await boot({
      openRepo: async () => { if (opens++ === 0) throw new StorageCorruptError('坏了', '{"raw":1}'); return new MemoryRepository() },
      deleteDb, now: fixedNow, randomId: () => 'p1',
    })
    expect(r.kind).toBe('corrupt')
    if (r.kind !== 'corrupt') return
    expect(r.rawDump).toBe('{"raw":1}')
    const again = await r.rebuild()
    expect(deleteDb).toHaveBeenCalled()
    expect(again.kind).toBe('ready')
  })

  it('其他错误原样抛出', async () => {
    await expect(boot({ openRepo: async () => { throw new Error('x') } })).rejects.toThrow('x')
  })
})

describe('createLazyAudio', () => {
  function fakeEngine() {
    const handlers: ((s: AudioContextState) => void)[] = []
    const engine = {
      currentTime: 5,
      outputLatencySec: 0.02,
      resume: vi.fn(async () => {}),
      play: vi.fn(() => ({ startSec: 5.1, endSec: 6 })),
      stopAll: vi.fn(),
      onStateChange: (fn: (s: AudioContextState) => void) => { handlers.push(fn); return () => {} },
    }
    return { engine: engine as unknown as AudioEngine, raw: engine, handlers }
  }

  it('unlock 前 play 抛错；unlock 只建一次引擎；之后转发并带上播放选项', async () => {
    const { engine, raw } = fakeEngine()
    const factory = vi.fn(() => engine)
    const a = createLazyAudio(factory)
    expect(a.ready).toBe(false)
    expect(a.currentTime).toBe(0)
    expect(() => a.play({ events: [], totalDurSec: 0 })).toThrow('音频尚未启用')
    await a.unlock()
    await a.unlock()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(raw.resume).toHaveBeenCalledTimes(2)
    expect(a.ready).toBe(true)
    expect(a.latencySec).toBe(0.02)
    a.play({ events: [], totalDurSec: 0 }, { cutContextAtSec: 1 })
    expect(raw.play).toHaveBeenCalledWith({ events: [], totalDurSec: 0 }, undefined, { cutContextAtSec: 1 })
  })

  it('引擎创建前注册的状态监听，创建后生效', async () => {
    const { engine, handlers } = fakeEngine()
    const a = createLazyAudio(() => engine)
    const seen: string[] = []
    a.onStateChange((s) => seen.push(s))
    await a.unlock()
    handlers.forEach((h) => h('suspended'))
    expect(seen).toEqual(['suspended'])
  })
})

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('randomUUID 可用时直接使用', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' })
    expect(newId()).toBe('uuid-1')
  })

  it('非安全上下文（无 randomUUID）：用 getRandomValues 生成 v4 格式 id', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { a.fill(0xff); return a } })
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('连 getRandomValues 都没有：退回时间戳加随机数', () => {
    vi.stubGlobal('crypto', {})
    const id = newId()
    expect(id.length).toBeGreaterThan(6)
    expect(newId()).not.toBe(id)
  })
})

describe('createLazyMic', () => {
  const audioWith = (context: AudioContext | null) => ({ context } as unknown as LazyAudio)
  const session = (): MicSession & { calibrations: number } => {
    const s = {
      calibrations: 0,
      noiseRms: 0,
      setNoiseRms: vi.fn((n: number) => { s.noiseRms = n }),
      calibrate: async () => { s.calibrations++; return 0.01 },
      start: vi.fn(),
      stop: async () => [],
      close: vi.fn(),
    }
    return s
  }

  it('音频未解锁时 ensure 抛错', async () => {
    await expect(createLazyMic(audioWith(null), async () => session()).ensure()).rejects.toThrow('音频尚未启用')
  })

  it('只打开、校准一次；start 前自动 ensure', async () => {
    const s = session()
    const open = vi.fn(async () => s)
    const mic = createLazyMic(audioWith({} as AudioContext), open)
    await mic.ensure()
    await mic.start(() => {})
    expect(open).toHaveBeenCalledTimes(1)
    expect(s.calibrations).toBe(1)
    expect(s.start).toHaveBeenCalled()
  })

  it('打开失败：记下原因并抛出', async () => {
    const mic = createLazyMic(audioWith({} as AudioContext), async () => { throw new MicError('denied', '没有麦克风权限') })
    await expect(mic.ensure()).rejects.toMatchObject({ reason: 'denied' })
    expect(mic.failure).toBe('denied')
  })

  it('start 在会话 start 执行之后才 resolve；没有会话时 stop 返回 []', async () => {
    const s = session()
    const order: string[] = []
    s.start = vi.fn(() => { order.push('session.start') })
    const mic = createLazyMic(audioWith({} as AudioContext), async () => s)
    expect(await mic.stop()).toEqual([])
    await mic.start(() => {}).then(() => order.push('resolved'))
    expect(order).toEqual(['session.start', 'resolved'])
  })
})

describe('createLazyMic：失效、校准与释放', () => {
  const audioWith = (context: AudioContext | null) => ({ context } as unknown as LazyAudio)
  type S = MicSession & { calibrations: number }
  const session = (): S => {
    const s = {
      calibrations: 0,
      noiseRms: 0,
      setNoiseRms: vi.fn((n: number) => { s.noiseRms = n }),
      calibrate: async () => { s.calibrations++; return 0.02 },
      start: vi.fn(),
      stop: async () => [],
      close: vi.fn(),
    }
    return s
  }
  const ctx = {} as AudioContext

  it('stop 被拒：关掉该会话；下一次 start 重开（open 共 2 次）', async () => {
    const a = session()
    a.stop = async () => { throw new Error('dead') }
    const b = session()
    const sessions = [a, b]
    const open = vi.fn(async () => sessions.shift()!)
    const mic = createLazyMic(audioWith(ctx), open)
    await mic.start(() => {})
    await expect(mic.stop()).rejects.toThrow('dead')
    expect(a.close).toHaveBeenCalled()
    await mic.start(() => {})
    expect(open).toHaveBeenCalledTimes(2)
    expect(b.start).toHaveBeenCalled()
  })

  it('session.start 抛错：关掉会话、重新抛出，下次重开', async () => {
    const a = session()
    a.start = vi.fn(() => { throw new Error('x') })
    const b = session()
    const sessions = [a, b]
    const open = vi.fn(async () => sessions.shift()!)
    const mic = createLazyMic(audioWith(ctx), open)
    await expect(mic.start(() => {})).rejects.toThrow('x')
    expect(a.close).toHaveBeenCalled()
    await mic.start(() => {})
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('ensure 之后 start 不再校准', async () => {
    const s = session()
    const mic = createLazyMic(audioWith(ctx), async () => s)
    await mic.ensure()
    await mic.start(() => {})
    expect(s.calibrations).toBe(1)
  })

  it('没有先 ensure 就 start：不校准，噪声基线为 0', async () => {
    const s = session()
    const mic = createLazyMic(audioWith(ctx), async () => s)
    await mic.start(() => {})
    expect(s.calibrations).toBe(0)
    expect(s.setNoiseRms).toHaveBeenCalledWith(0)
  })

  it('死后重开：沿用上一次校准的噪声基线，不重新校准', async () => {
    const a = session()
    a.stop = async () => { throw new Error('dead') }
    const b = session()
    const sessions = [a, b]
    const mic = createLazyMic(audioWith(ctx), async () => sessions.shift()!)
    await mic.ensure()
    await mic.start(() => {})
    await expect(mic.stop()).rejects.toThrow()
    await mic.start(() => {})
    expect(b.calibrations).toBe(0)
    expect(b.setNoiseRms).toHaveBeenCalledWith(0.02)
  })

  it('ensure 的 onCalibrating 在打开之后、校准之前调用', async () => {
    const s = session()
    const order: string[] = []
    s.calibrate = async () => { order.push('calibrate'); return 0.01 }
    const mic = createLazyMic(audioWith(ctx), async () => { order.push('open'); return s })
    await mic.ensure({ onCalibrating: () => order.push('onCalibrating') })
    expect(order).toEqual(['open', 'onCalibrating', 'calibrate'])
  })

  it('打开进行中 close()：迟到的会话被关闭且不缓存', async () => {
    const a = session()
    const b = session()
    let resolveA!: (s: S) => void
    const queue: Array<() => Promise<S>> = [() => new Promise<S>((r) => { resolveA = r }), async () => b]
    const open = vi.fn(() => queue.shift()!())
    const mic = createLazyMic(audioWith(ctx), open)
    const p = mic.ensure()
    const settled = p.then(() => 'ok', () => 'rejected')
    mic.close()
    resolveA(a)
    expect(await settled).toBe('rejected')
    expect(a.close).toHaveBeenCalled()
    await mic.start(() => {})
    expect(open).toHaveBeenCalledTimes(2)
    expect(b.start).toHaveBeenCalled()
  })
})
