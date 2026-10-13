import { describe, expect, it } from 'vitest'
import { ACCENT_OFF_FACTOR, onsetsToNotes, type TimedOnset } from './rhythm'

const onsets: TimedOnset[] = [
  { atSec: 0, durSec: 0.5, accent: true },
  { atSec: 0.5, durSec: 0.25, accent: false },
  { atSec: 0.75, durSec: 0.25, accent: true },
]

describe('onsetsToNotes（FWD-2：accent 与力度轴的合成规则）', () => {
  it('ACCENT_OFF_FACTOR 为 0.75（P-2b spec D9）', () => {
    expect(ACCENT_OFF_FACTOR).toBe(0.75)
  })

  it('重音 gain = velocity，非重音 gain = velocity × ACCENT_OFF_FACTOR', () => {
    const notes = onsetsToNotes(onsets, 60, 0.8)
    expect(notes[0].gain).toBeCloseTo(0.8, 12)
    expect(notes[1].gain).toBeCloseTo(0.8 * ACCENT_OFF_FACTOR, 12)
    expect(notes[2].gain).toBeCloseTo(0.8, 12)
  })

  it('保留时刻与时值，全部落在同一音高', () => {
    const notes = onsetsToNotes(onsets, 67, 1)
    expect(notes.map((n) => n.atSec)).toEqual([0, 0.5, 0.75])
    expect(notes.map((n) => n.durSec)).toEqual([0.5, 0.25, 0.25])
    expect(notes.every((n) => n.midi === 67)).toBe(true)
  })

  it('空输入返回空数组', () => {
    expect(onsetsToNotes([], 60, 0.8)).toEqual([])
  })
})
