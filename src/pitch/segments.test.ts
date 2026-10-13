import { describe, expect, it } from 'vitest'
import { concat, framesOf, silence, tone, track } from './synth'
import { createSegmenter, isVoiced, segmentSignal, SEGMENT_JITTER_CENTS } from './segments'
import { HOP_SIZE, SAMPLE_RATE, YIN_THRESHOLD, yinFrame } from './yin'

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

// 以音分轨迹合成相位连续的真实感人声：points 为 [秒, 相对 baseHz 的音分] 折线
function sung(baseHz: number, points: [number, number][], opts: { vibratoCents?: number } = {}): Float32Array {
  const dur = points[points.length - 1][0]
  const centsAt = (t: number) => {
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        const [t0, c0] = points[i - 1]
        const [t1, c1] = points[i]
        return t1 === t0 ? c1 : c0 + ((c1 - c0) * (t - t0)) / (t1 - t0)
      }
    }
    return points[points.length - 1][1]
  }
  const vib = opts.vibratoCents ?? 0
  return track((t) => baseHz * Math.pow(2, (centsAt(t) + vib * Math.sin(2 * Math.PI * 5.5 * t)) / 1200), dur)
}

describe('真实唱法的稳定段（评审 I1–I4）', () => {
  it('-100 音分、0.3 s 的滑入 + 1 s 长音：一个段，落在目标', () => {
    const segs = segmentSignal(sung(220, [[0, -100], [0.3, 0], [1.3, 0]]))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 220))).toBeLessThan(10)
  })

  it('-300 音分、300 音分/秒的慢滑入 + 0.8 s 长音：一个段，落在目标', () => {
    const segs = segmentSignal(sung(220, [[0, -300], [1, 0], [1.8, 0]]))
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 220))).toBeLessThan(10)
  })

  it('1 s 内下垂 90 音分的音：一个段', () => {
    expect(segmentSignal(sung(220, [[0, 0], [1, -90]]))).toHaveLength(1)
  })

  it('do 0.5 s + 350 音分/秒的收尾下滑 -150 + mi 0.5 s：恰好两段，无假音', () => {
    const fall = 150 / 350
    const segs = segmentSignal(
      sung(262, [[0, 0], [0.5, 0], [0.5 + fall, -150], [0.5 + fall, 400], [1 + fall, 400]]),
    )
    expect(segs).toHaveLength(2)
    expect(Math.abs(cents(segs[0].medianHz, 262))).toBeLessThan(10)
    expect(Math.abs(cents(segs[1].medianHz, 262 * Math.pow(2, 400 / 1200)))).toBeLessThan(10)
  })

  for (const v of [35, 60, 100]) {
    it(`颤音 ±${v} 音分、5.5 Hz、1 s：一个段，中位数在 10 音分内`, () => {
      const segs = segmentSignal(sung(294, [[0, 0], [1, 0]], { vibratoCents: v }))
      expect(segs).toHaveLength(1)
      expect(Math.abs(cents(segs[0].medianHz, 294))).toBeLessThan(10)
    })
  }

  it('起音前 3 帧读成 2f0，之后 196 Hz 长音：中位数仍在低八度', () => {
    const hop = HOP_SIZE / SAMPLE_RATE
    const seg = createSegmenter({ hopSec: hop })
    for (let i = 0; i < 60; i++) seg.push({ f0Hz: i < 3 ? 392 : 196, aperiodicity: 0.05, rms: 0.1 }, i * hop)
    seg.flush()
    const segs = seg.segments()
    expect(segs).toHaveLength(1)
    expect(Math.abs(cents(segs[0].medianHz, 196))).toBeLessThan(5)
  })

  it('do → 唱高 25 音分的 ti（相差 1125 音分），连唱无停顿：两段', () => {
    const segs = segmentSignal(sung(262, [[0, 0], [0.5, 0], [0.5, 1125], [1, 1125]]))
    expect(segs).toHaveLength(2)
  })

  for (const rate of [200, 300]) {
    it(`${rate} 音分/秒的 400 音分慢滑音，随后静音：没有稳定段`, () => {
      const d = 400 / rate
      expect(segmentSignal(concat(sung(262, [[0, 0], [d, 400]]), silence(0.3)))).toHaveLength(0)
    })
  }

  it('跳变切段时 push 返回已收尾的那一段', () => {
    const hop = HOP_SIZE / SAMPLE_RATE
    const seg = createSegmenter({ hopSec: hop })
    const returned = []
    for (let i = 0; i < 80; i++) {
      const r = seg.push({ f0Hz: i < 40 ? 196 : 247, aperiodicity: 0.05, rms: 0.1 }, i * hop)
      if (r) returned.push({ i, r })
    }
    expect(returned).toHaveLength(1)
    expect(returned[0].i).toBeGreaterThanOrEqual(40)
    expect(Math.abs(cents(returned[0].r.medianHz, 196))).toBeLessThan(5)
    expect(seg.flush()).not.toBeNull()
    expect(seg.segments()).toHaveLength(2)
  })

  it('同一信号：增量 push（含 flush）与 segmentSignal 结果完全一致', () => {
    const sig = concat(tone(262, 0.4), silence(0.15), tone(330, 0.4), tone(392, 0.3))
    const seg = createSegmenter()
    const closed = []
    for (const { atSec, frame } of framesOf(sig)) {
      const r = seg.push(yinFrame(frame), atSec)
      if (r) closed.push(r)
    }
    const last = seg.flush()
    if (last) closed.push(last)
    expect(closed).toEqual(segmentSignal(sig))
    expect(seg.segments()).toEqual(closed)
    expect(closed.length).toBeGreaterThanOrEqual(2)
  })
})
