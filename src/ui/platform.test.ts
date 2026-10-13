import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioEngine } from '../audio/AudioEngine'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError } from '../storage/types'
import { boot, createLazyAudio, newId } from './platform'

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
