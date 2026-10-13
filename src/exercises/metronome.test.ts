import { describe, expect, it } from 'vitest'
import { freqToMidi } from '../music/pitch'
import { notesToPlan } from '../music/playback'
import type { Meter } from '../music/rhythm'
import type { ContextLevel } from '../music/tonalContext'
import {
  CLICK_GAIN,
  CLICK_GAIN_ACCENT,
  metronomeBarNotes,
  pulseGrid,
  pulsesPerBar,
  unitsPerPulse,
  wrapWithMetronome,
} from './metronome'
import type { MetronomeMode } from './types'

const M24: Meter = { beatsPerBar: 2, beatUnit: 4 }
const M34: Meter = { beatsPerBar: 3, beatUnit: 4 }
const M44: Meter = { beatsPerBar: 4, beatUnit: 4 }
const M68: Meter = { beatsPerBar: 6, beatUnit: 8 }

const CONTENT_MIDI = 60
const CLICK_MIDI = 72
const content = notesToPlan([{ midi: CONTENT_MIDI, atSec: 0, durSec: 0.3 }], 'piano')

function wrap(level: ContextLevel, mode: MetronomeMode, bars: Meter[] = [M44, M44], contentDurSec = 8) {
  return wrapWithMetronome({
    bars, bpm: 60, level, mode, clickMidi: CLICK_MIDI, timbreId: 'piano', content, contentDurSec,
  })
}
const clicks = (r: ReturnType<typeof wrap>) =>
  r.plan.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === CLICK_MIDI)
const contentClicks = (r: ReturnType<typeof wrap>) =>
  clicks(r).filter((e) => e.atSec >= r.contentStartSec - 1e-9)

describe('感知拍（FWD-6）', () => {
  it('x/4 一拍一个四分音符；6/8 一拍是附点四分＝3 个八分', () => {
    expect(unitsPerPulse(M44)).toBe(1)
    expect(unitsPerPulse(M68)).toBe(3)
    expect(pulsesPerBar(M34)).toBe(3)
    expect(pulsesPerBar(M68)).toBe(2)
  })

  it('pulseGrid：按小节铺感知拍，标出每小节第一拍', () => {
    expect(pulseGrid([M34, M24], 120)).toEqual([
      { atSec: 0, downbeat: true },
      { atSec: 0.5, downbeat: false },
      { atSec: 1, downbeat: false },
      { atSec: 1.5, downbeat: true },
      { atSec: 2, downbeat: false },
    ])
    expect(pulseGrid([M68], 60).map((p) => p.atSec)).toEqual([0, 1])
  })
})

describe('wrapWithMetronome：metered', () => {
  it('L0：两小节预备拍，强拍加重；内容中每拍都响', () => {
    const r = wrap(0, 'metered')
    expect(r.contentStartSec).toBe(8)
    const pre = clicks(r).filter((e) => e.atSec < 8)
    expect(pre.map((e) => e.atSec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(pre.map((e) => e.gain)).toEqual([
      CLICK_GAIN_ACCENT, CLICK_GAIN, CLICK_GAIN, CLICK_GAIN,
      CLICK_GAIN_ACCENT, CLICK_GAIN, CLICK_GAIN, CLICK_GAIN,
    ])
    expect(contentClicks(r)).toHaveLength(8)
  })

  it('L1：一小节预备拍', () => {
    expect(wrap(1, 'metered').contentStartSec).toBe(4)
  })

  it('L2：内容中只在每小节第一拍响', () => {
    const r = wrap(2, 'metered')
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 4])
    expect(contentClicks(r).every((e) => e.gain === CLICK_GAIN_ACCENT)).toBe(true)
  })

  it('L3：内容中不响', () => {
    expect(contentClicks(wrap(3, 'metered'))).toHaveLength(0)
  })

  it('L4：只在内容前 40% 响', () => {
    const r = wrap(4, 'metered')
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 1, 2, 3])
  })

  it('预备拍按第一小节的拍号分组', () => {
    expect(wrap(1, 'metered', [M34, M34], 6).contentStartSec).toBe(3)
  })
})

describe('wrapWithMetronome：neutral（不透露拍号与强拍）', () => {
  it('预备拍固定 4 个感知拍（L0 为 8 个），与拍号无关，全部同力度', () => {
    for (const bars of [[M24, M24], [M34, M34], [M44, M44]]) {
      const r = wrap(1, 'neutral', bars, 6)
      expect(r.contentStartSec).toBe(4)
      expect(clicks(r).every((e) => e.gain === CLICK_GAIN)).toBe(true)
    }
    expect(wrap(0, 'neutral').contentStartSec).toBe(8)
  })

  it('L2：隔一个感知拍响一次，不跟强拍对齐', () => {
    const r = wrap(2, 'neutral', [M34, M34], 6)
    expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 2, 4])
  })
})

describe('内容与音区', () => {
  it('内容整体后移 contentStartSec，事件按时刻排序', () => {
    const r = wrap(1, 'metered')
    const c = r.plan.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === CONTENT_MIDI)
    expect(c.map((e) => e.atSec)).toEqual([4])
    const times = r.plan.events.map((e) => e.atSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('点击过高时整份折叠回 36–96', () => {
    const r = wrapWithMetronome({
      bars: [M44], bpm: 60, level: 1, mode: 'metered', clickMidi: 100, timbreId: 'piano', content, contentDurSec: 4,
    })
    for (const e of r.plan.events) expect(freqToMidi(e.freqHz)).toBeLessThanOrEqual(96 + 1e-6)
  })
})

describe('metronomeBarNotes（R 轨反馈锚点）', () => {
  it('一小节按拍号点击，第一拍加重', () => {
    expect(metronomeBarNotes(M34, 60, CLICK_MIDI).map((n) => [n.atSec, n.gain])).toEqual([
      [0, CLICK_GAIN_ACCENT], [1, CLICK_GAIN], [2, CLICK_GAIN],
    ])
  })
})

describe('中性 L4 不泄露拍数（修复轮 1）', () => {
  it('neutral L4 内容中恰好 3 个点击，偏移为第 0、1、2 拍，与拍号无关', () => {
    const cases: [Meter[], number][] = [
      [[M24, M24], 4],
      [[M34, M34], 6],
      [[M44, M44], 8],
    ]
    for (const [bars, durSec] of cases) {
      const r = wrap(4, 'neutral', bars, durSec)
      expect(contentClicks(r).map((e) => e.atSec - r.contentStartSec)).toEqual([0, 1, 2])
    }
  })

  it('6/8 与 2/4 的预备拍和网格按 bpm 90 计算', () => {
    const r1m = wrapWithMetronome({
      bars: [M68, M68], bpm: 90, level: 1, mode: 'metered', clickMidi: CLICK_MIDI, timbreId: 'piano', content, contentDurSec: 4,
    })
    expect(r1m.contentStartSec).toBeCloseTo(2 * (60 / 90), 9)
    const r1n = wrapWithMetronome({
      bars: [M68, M68], bpm: 90, level: 1, mode: 'neutral', clickMidi: CLICK_MIDI, timbreId: 'piano', content, contentDurSec: 4,
    })
    expect(r1n.contentStartSec).toBeCloseTo(4 * (60 / 90), 9)
    const grid = pulseGrid([M68, M68], 90)
    expect(grid).toHaveLength(4)
    expect(grid.map((p) => p.atSec)).toEqual([0, 60 / 90, 120 / 90, 180 / 90].map((x) => expect.closeTo(x, 9)))
    expect(grid.map((p, i) => [i, p.downbeat]).filter(([, d]) => d).map(([i]) => i)).toEqual([0, 2])
  })
})
