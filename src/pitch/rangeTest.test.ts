import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../music/pitch'
import { MIN_RANGE_SEMITONES, pickHeldNote, validateRange } from './rangeTest'

describe('pickHeldNote', () => {
  it('取最长的稳定段，转成最近的 MIDI', () => {
    const segs = [
      { startSec: 0, endSec: 0.3, medianHz: midiToFreq(50) },
      { startSec: 0.5, endSec: 1.5, medianHz: midiToFreq(45) * Math.pow(2, 20 / 1200) },
    ]
    expect(pickHeldNote(segs)).toBe(45)
    expect(pickHeldNote([])).toBeNull()
  })
})

describe('validateRange', () => {
  it(`跨度 ≥ ${MIN_RANGE_SEMITONES} 半音才通过；顺序颠倒自动交换`, () => {
    expect(validateRange(45, 64)).toEqual({ ok: true, range: { lowMidi: 45, highMidi: 64 } })
    expect(validateRange(64, 45)).toEqual({ ok: true, range: { lowMidi: 45, highMidi: 64 } })
    expect(validateRange(50, 56).ok).toBe(false)
    expect(validateRange(null, 60)).toMatchObject({ ok: false, reason: expect.stringMatching(/没听到/) })
  })
})
