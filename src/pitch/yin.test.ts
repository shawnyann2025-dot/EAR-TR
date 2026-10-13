import { describe, expect, it } from 'vitest'
import { FRAME_SIZE, SAMPLE_RATE, yinFrame } from './yin'
import { noise, silence, tone } from './synth'

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)
const frameOf = (sig: Float32Array) => sig.subarray(0, FRAME_SIZE)

describe('yinFrame（主 spec §9.1）', () => {
  it.each([80, 110, 196, 262, 440, 660, 880, 1000])('正弦 %d Hz：误差 ≤ ±5 音分', (hz) => {
    const f = yinFrame(frameOf(tone(hz, 0.1)), SAMPLE_RATE)
    expect(f.f0Hz).not.toBeNull()
    expect(Math.abs(cents(f.f0Hz!, hz))).toBeLessThanOrEqual(5)
    expect(f.aperiodicity).toBeLessThan(0.15)
  })

  it.each([98, 147, 220, 523])('富泛音音 %d Hz：不报错八度，误差 ≤ ±5 音分', (hz) => {
    const partials = [1, 0.8, 0.6, 0.5, 0.4, 0.3].map((amp, i) => ({ ratio: i + 1, amp }))
    const f = yinFrame(frameOf(tone(hz, 0.1, { partials })), SAMPLE_RATE)
    expect(Math.abs(cents(f.f0Hz!, hz))).toBeLessThanOrEqual(5)
  })

  it('缺基频（只有 2、3、4 次泛音）：仍报基频，不报高八度', () => {
    const partials = [2, 3, 4].map((ratio) => ({ ratio, amp: 1 }))
    const f = yinFrame(frameOf(tone(150, 0.1, { partials })), SAMPLE_RATE)
    expect(Math.abs(cents(f.f0Hz!, 150))).toBeLessThanOrEqual(50)
  })

  it('白噪声与静音判无声', () => {
    expect(yinFrame(frameOf(noise(0.1, 7, 0.5)), SAMPLE_RATE).f0Hz).toBeNull()
    const s = yinFrame(frameOf(silence(0.1)), SAMPLE_RATE)
    expect(s.f0Hz).toBeNull()
    expect(s.rms).toBe(0)
  })

  it('rms 正确：振幅 a 的正弦 rms ≈ a/√2', () => {
    const f = yinFrame(frameOf(tone(440, 0.1, { amp: 0.5 })), SAMPLE_RATE)
    expect(f.rms).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})
