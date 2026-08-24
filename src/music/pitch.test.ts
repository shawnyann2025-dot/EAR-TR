import { describe, expect, it } from 'vitest'
import { midiToFreq } from './pitch'

describe('midiToFreq', () => {
  it('把 A4 (MIDI 69) 映射到 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
  })

  it('低八度频率减半', () => {
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
  })

  it('高八度频率加倍', () => {
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
  })

  it('相邻半音之比为 2^(1/12)', () => {
    expect(midiToFreq(61) / midiToFreq(60)).toBeCloseTo(Math.pow(2, 1 / 12), 10)
  })
})
