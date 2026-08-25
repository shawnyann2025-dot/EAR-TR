import { describe, expect, it } from 'vitest'
import {
  beatsToSeconds,
  expandRhythm,
  rhythmDurationSec,
  type RhythmPattern,
} from './rhythm'

const FOUR_FOUR = { beatsPerBar: 4, beatUnit: 4 } as const

const QUARTERS: RhythmPattern = {
  meter: FOUR_FOUR,
  bars: 1,
  events: [
    { onsetBeats: 0, durBeats: 1, accent: true },
    { onsetBeats: 1, durBeats: 1, accent: false },
    { onsetBeats: 2, durBeats: 1, accent: false },
    { onsetBeats: 3, durBeats: 1, accent: false },
  ],
}

describe('beatsToSeconds', () => {
  it('120 BPM 下一拍是 0.5 秒', () => {
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5, 10)
  })

  it('60 BPM 下四拍是 4 秒', () => {
    expect(beatsToSeconds(4, 60)).toBeCloseTo(4, 10)
  })
})

describe('expandRhythm', () => {
  it('120 BPM、起点 0：四个四分音符落在 0/0.5/1.0/1.5 秒', () => {
    const onsets = expandRhythm(QUARTERS, 120, 0)
    expect(onsets.map((o) => o.atSec)).toEqual([0, 0.5, 1, 1.5])
    expect(onsets.every((o) => o.durSec === 0.5)).toBe(true)
  })

  it('起点偏移原样加到每个事件上', () => {
    const onsets = expandRhythm(QUARTERS, 120, 2)
    expect(onsets.map((o) => o.atSec)).toEqual([2, 2.5, 3, 3.5])
  })

  it('保留重音标记', () => {
    const onsets = expandRhythm(QUARTERS, 120, 0)
    expect(onsets.map((o) => o.accent)).toEqual([true, false, false, false])
  })

  it('速度翻倍则全部时值减半（属性测试）', () => {
    const slow = expandRhythm(QUARTERS, 60, 0)
    const fast = expandRhythm(QUARTERS, 120, 0)
    slow.forEach((s, i) => {
      expect(fast[i].atSec).toBeCloseTo(s.atSec / 2, 10)
      expect(fast[i].durSec).toBeCloseTo(s.durSec / 2, 10)
    })
  })

  it('切分节奏的起点保持非整数拍位', () => {
    const synco: RhythmPattern = {
      meter: FOUR_FOUR,
      bars: 1,
      events: [
        { onsetBeats: 0, durBeats: 0.5, accent: true },
        { onsetBeats: 0.5, durBeats: 1, accent: true },
        { onsetBeats: 1.5, durBeats: 0.5, accent: false },
      ],
    }
    const onsets = expandRhythm(synco, 120, 0)
    expect(onsets.map((o) => o.atSec)).toEqual([0, 0.25, 0.75])
  })
})

describe('rhythmDurationSec', () => {
  it('时长按小节数与拍号算，而非按最后一个音符', () => {
    const sparse: RhythmPattern = {
      meter: FOUR_FOUR,
      bars: 2,
      events: [{ onsetBeats: 0, durBeats: 1, accent: true }],
    }
    // 2 小节 × 4 拍 × 0.5 秒
    expect(rhythmDurationSec(sparse, 120)).toBeCloseTo(4, 10)
  })
})

// 6/8 是复合拍：beatsPerBar 必须填「记谱拍数」（六个八分音符 = 6），
// 而不是「感知拍数」（指挥数的三个附点四分音符 = 3）。填错会让时值计算静默出错。
const SIX_EIGHT = { beatsPerBar: 6, beatUnit: 8 } as const

const COMPOUND_EIGHTHS: RhythmPattern = {
  meter: SIX_EIGHT,
  bars: 1,
  events: [
    { onsetBeats: 0, durBeats: 1, accent: true },
    { onsetBeats: 1, durBeats: 1, accent: false },
    { onsetBeats: 2, durBeats: 1, accent: false },
    { onsetBeats: 3, durBeats: 1, accent: true },
    { onsetBeats: 4, durBeats: 1, accent: false },
    { onsetBeats: 5, durBeats: 1, accent: false },
  ],
}

describe('6/8 复合拍：beatsPerBar 是记谱拍数（八分音符个数），不是感知拍数', () => {
  it('rhythmDurationSec：120 BPM 下一小节 = 6 个八分音符 × 0.5 秒 = 3 秒', () => {
    // 期望值按 beatsToSeconds(bars × beatsPerBar, bpm) 手算：
    // beatsToSeconds(1 × 6, 120) = 6 × 60 / 120 = 3
    expect(rhythmDurationSec(COMPOUND_EIGHTHS, 120)).toBeCloseTo(3, 10)
  })

  it('expandRhythm：六个八分音符落在 0/0.5/1.0/1.5/2.0/2.5 秒，各时值 0.5 秒', () => {
    const onsets = expandRhythm(COMPOUND_EIGHTHS, 120, 0)
    expect(onsets.map((o) => o.atSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
    expect(onsets.every((o) => o.durSec === 0.5)).toBe(true)
  })
})
