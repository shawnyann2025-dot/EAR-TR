import { describe, expect, it } from 'vitest'
import { concat, framesOf, noise, silence, tone } from '../pitch/synth'
import { createPitchPipeline, type PipelineOut } from './pitchPipeline'

const SR = 48_000
const feed = (p: ReturnType<typeof createPitchPipeline>, signal: Float32Array) => {
  const outs: PipelineOut[] = []
  for (const { atSec, frame } of framesOf(signal)) outs.push(...p.handle({ type: 'frame', samples: frame, atSec, sampleRate: SR }))
  return outs
}

describe('pitchPipeline', () => {
  it('空闲时丢帧，不输出任何东西', () => {
    const p = createPitchPipeline()
    expect(feed(p, tone(220, 0.5))).toEqual([])
  })

  it('校准：输出帧 rms 的中位数', () => {
    const p = createPitchPipeline()
    p.handle({ type: 'calibrate-start' })
    feed(p, noise(1, 3, 0.02))
    const [out] = p.handle({ type: 'calibrate-end' })
    if (out.type !== 'calibrated') throw new Error()
    expect(out.noiseRms).toBeGreaterThan(0.009)
    expect(out.noiseRms).toBeLessThan(0.014)
  })

  it('没有校准帧时噪声基线为 0', () => {
    const p = createPitchPipeline()
    p.handle({ type: 'calibrate-start' })
    expect(p.handle({ type: 'calibrate-end' })).toEqual([{ type: 'calibrated', noiseRms: 0 }])
  })

  it('收音：唱两个音，逐段输出；停止时返回全部段', () => {
    const p = createPitchPipeline()
    p.handle({ type: 'capture-start', noiseRms: 0.001 })
    const live = feed(p, concat(silence(0.1), tone(262, 0.6), silence(0.2), tone(330, 0.6), silence(0.2)))
    const stopped = p.handle({ type: 'capture-stop' })
    const segs = live.filter((o) => o.type === 'segment')
    expect(segs.length).toBeGreaterThanOrEqual(1)
    const last = stopped.at(-1)
    if (!last || last.type !== 'stopped') throw new Error('应以 stopped 结束')
    expect(last.segments.map((s) => Math.round(s.medianHz))).toEqual([262, 330])
  })

  it('停止后再来的帧被丢弃', () => {
    const p = createPitchPipeline()
    p.handle({ type: 'capture-start', noiseRms: 0 })
    p.handle({ type: 'capture-stop' })
    expect(feed(p, tone(220, 0.5))).toEqual([])
  })
})
