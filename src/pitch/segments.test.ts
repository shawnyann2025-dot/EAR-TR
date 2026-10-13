import { describe, expect, it } from 'vitest'
import { concat, silence, tone } from './synth'
import { createSegmenter, isVoiced, segmentSignal, SEGMENT_JITTER_CENTS } from './segments'
import { HOP_SIZE, SAMPLE_RATE, YIN_THRESHOLD } from './yin'

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('isVoiced', () => {
  it('需要有 f0、周期性够、能量高于噪声基线两倍', () => {
    expect(isVoiced({ f0Hz: 220, aperiodicity: 0.05, rms: 0.1 }, 0.01)).toBe(true)
    expect(isVoiced({ f0Hz: null, aperiodicity: 0.05, rms: 0.1 }, 0.01)).toBe(false)
    expect(isVoiced({ f0Hz: 220, aperiodicity: YIN_THRESHOLD + 0.01, rms: 0.1 }, 0.01)).toBe(false)
    expect(isVoiced({ f0Hz: 220, aperiodicity: 0.05, rms: 0.015 }, 0.01)).toBe(false)
  })
})

describe('稳定段（主 spec §9.2、P-4 spec §3.2）', () => {
  it('持续 0.5 s 的音：一个段，中位数准', () => {
    const segs = segmentSignal(tone(220, 0.5))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 220))).toBeLessThan(5)
  })

  it('短于 150 ms 的音不成段', () => {
    expect(segmentSignal(concat(silence(0.1), tone(330, 0.1), silence(0.2)))).toHaveLength(0)
  })

  it('静音间隙把两个音分开', () => {
    const segs = segmentSignal(concat(tone(262, 0.4), silence(0.15), tone(330, 0.4)))
    expect(segs.map((s) => Math.round(s.medianHz))).toEqual([262, 330])
  })

  it('连唱不停顿（音高直接跳 4 个半音）也能分成两段', () => {
    const segs = segmentSignal(concat(tone(262, 0.4), tone(330, 0.4)))
    expect(segs).toHaveLength(2)
  })

  it(`${SEGMENT_JITTER_CENTS} 音分以内的颤音仍是一个段，中位数接近中心`, () => {
    const segs = segmentSignal(tone(294, 0.8, { vibratoCents: 20 }))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 294))).toBeLessThan(10)
  })

  it('缓慢滑音（一秒滑一个大三度）不形成稳定段', () => {
    // 相位连续的真滑音：1 s 内从 262 Hz 升 400 音分
    const n = SAMPLE_RATE
    const sig = new Float32Array(n)
    let phase = 0
    for (let i = 0; i < n; i++) {
      phase += (262 * Math.pow(2, i / n / 3)) / SAMPLE_RATE
      sig[i] = 0.5 * Math.sin(2 * Math.PI * phase)
    }
    expect(segmentSignal(sig)).toHaveLength(0)
  })

  it('噪声基线：低于两倍基线的弱音不算有声', () => {
    expect(segmentSignal(tone(220, 0.5, { amp: 0.01 }), { noiseRms: 0.02 })).toHaveLength(0)
  })

  it('增量 push 与一次性 segmentSignal 结果一致；push 在段收尾时返回该段', () => {
    const seg = createSegmenter()
    const closed = []
    for (let i = 0; i < 40; i++) {
      const r = seg.push({ f0Hz: 220, aperiodicity: 0.05, rms: 0.1 }, i * 0.01)
      if (r) closed.push(r)
    }
    for (let i = 40; i < 50; i++) {
      const r = seg.push({ f0Hz: null, aperiodicity: 1, rms: 0 }, i * 0.01)
      if (r) closed.push(r)
    }
    expect(closed).toHaveLength(1)
    expect(seg.segments()).toEqual(closed)
    expect(seg.flush()).toBeNull()
  })

  it('八度闪跳：196 Hz 长音每 4 帧读成 392 Hz，仍是一个段，中位数在 5 音分内', () => {
    const hop = HOP_SIZE / SAMPLE_RATE
    const seg = createSegmenter({ hopSec: hop })
    for (let i = 0; i < 60; i++) {
      const hz = i % 4 === 3 ? 392 : 196
      seg.push({ f0Hz: hz, aperiodicity: 0.05, rms: 0.1 }, i * hop)
    }
    seg.flush()
    const segs = seg.segments()
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 196))).toBeLessThan(5)
  })
})
