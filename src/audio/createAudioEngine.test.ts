import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioEngine } from './AudioEngine'

afterEach(() => vi.unstubAllGlobals())

describe('createAudioEngine（P-4 spec §4.1）', () => {
  it('以 48 kHz 创建，并暴露 context', () => {
    const seen: unknown[] = []
    class FakeCtx { constructor(opts?: unknown) { seen.push(opts) } }
    vi.stubGlobal('window', { AudioContext: FakeCtx })
    const engine = createAudioEngine()
    expect(seen).toEqual([{ sampleRate: 48000 }])
    expect(engine.context).toBeInstanceOf(FakeCtx)
  })

  it('浏览器拒绝 sampleRate 选项时退回默认构造', () => {
    const seen: unknown[] = []
    class FakeCtx { constructor(opts?: unknown) { if (opts) throw new Error('NotSupported'); seen.push('default') } }
    vi.stubGlobal('window', { AudioContext: FakeCtx })
    createAudioEngine()
    expect(seen).toEqual(['default'])
  })
})
