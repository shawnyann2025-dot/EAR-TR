import { describe, expect, it, vi } from 'vitest'
import type { PlaybackPlan } from '../music/playback'
import { AudioEngine } from './AudioEngine'
import { DRUMS } from './drums'
import { planToVoices } from './voices'

function fakeCtx() {
  const created = { osc: [] as any[], gain: [] as any[], src: [] as any[], filter: [] as any[], buffers: 0 }
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() })
  const node = () => ({ connect: vi.fn(function (this: unknown, n: unknown) { return n }), disconnect: vi.fn() })
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => { const o = { ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null }; created.osc.push(o); return o }),
    createGain: vi.fn(() => { const g = { ...node(), gain: param() }; created.gain.push(g); return g }),
    createBufferSource: vi.fn(() => { const s = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null }; created.src.push(s); return s }),
    createBiquadFilter: vi.fn(() => { const f = { ...node(), type: 'lowpass', frequency: param() }; created.filter.push(f); return f }),
    createBuffer: vi.fn((_ch: number, len: number) => { created.buffers++; const data = new Float32Array(len); return { getChannelData: () => data } }),
  }
  return { ctx, created }
}

const plan = (events: PlaybackPlan['events']): PlaybackPlan => ({ events, totalDurSec: 1 })
const drumEv = (drum: 'kick' | 'snare' | 'hat', atSec: number) => ({ atSec, freqHz: 0, durSec: 0.1, timbreId: 'piano' as const, gain: 1, drum })

describe('鼓（P-5 spec §3.2）', () => {
  it('planToVoices 不把鼓当作有音高的声部', () => {
    expect(planToVoices(plan([drumEv('kick', 0)]), 0)).toEqual([])
  })

  it('底鼓：正弦，音高从 150 下滑到 50 Hz', () => {
    const { ctx, created } = fakeCtx()
    new AudioEngine(ctx as unknown as AudioContext).play(plan([drumEv('kick', 0.5)]), 0)
    expect(created.osc).toHaveLength(1)
    const f = created.osc[0].frequency
    expect(f.setValueAtTime).toHaveBeenCalledWith(150, 0.5)
    expect(f.exponentialRampToValueAtTime).toHaveBeenCalledWith(50, 0.5 + DRUMS.kick.dropSec!)
    expect(created.osc[0].stop).toHaveBeenCalledWith(0.5 + DRUMS.kick.decaySec)
  })

  it('军鼓与踩镲：噪声源 → 滤波 → 包络；噪声缓冲只创建一次', () => {
    const { ctx, created } = fakeCtx()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(plan([drumEv('snare', 0), drumEv('hat', 0.25), drumEv('hat', 0.5)]), 0)
    expect(created.src).toHaveLength(3)
    expect(created.buffers).toBe(1)
    expect(created.filter.map((f) => f.type)).toEqual(['bandpass', 'highpass', 'highpass'])
    expect(created.filter[1].frequency.setValueAtTime).toHaveBeenCalledWith(7000, 0.25)
  })

  it('endSec 计入鼓的衰减', () => {
    const { ctx } = fakeCtx()
    const r = new AudioEngine(ctx as unknown as AudioContext).play(plan([drumEv('kick', 1)]), 0)
    expect(r.endSec).toBeCloseTo(1 + DRUMS.kick.decaySec)
  })

  it('stopAll 也停掉鼓', () => {
    const { ctx, created } = fakeCtx()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(plan([drumEv('snare', 0)]), 0)
    engine.stopAll()
    expect(created.src[0].disconnect).toHaveBeenCalled()
    expect(engine.activeCount).toBe(0)
  })
})
