import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS, chordToMidi, voiceChord, type ChordQuality } from './chord'

const C = (inversion: number, quality: ChordQuality = 'maj') => ({
  rootDegree: 'do' as const,
  quality,
  inversion,
})

describe('voiceChord（FWD-3：独立低音声部）', () => {
  it('上方声部是从根音起的原位密集排列', () => {
    expect(voiceChord(C(0), 60).upperMidis).toEqual([60, 64, 67])
    expect(voiceChord(C(2), 60).upperMidis).toEqual([60, 64, 67])
    expect(voiceChord(C(0, 'dom7'), 60).upperMidis).toEqual([60, 64, 67, 70])
  })

  it('低音是转位指定的和弦音，落在根音下方一个八度的区域', () => {
    expect(voiceChord(C(0), 60).bassMidi).toBe(48) // C
    expect(voiceChord(C(1), 60).bassMidi).toBe(52) // E
    expect(voiceChord(C(2), 60).bassMidi).toBe(55) // G
    expect(voiceChord(C(3, 'dom7'), 60).bassMidi).toBe(58) // B♭
  })

  it('转位数按音数取模', () => {
    expect(voiceChord(C(3), 60).bassMidi).toBe(48)
    expect(voiceChord(C(-1), 60).bassMidi).toBe(55)
  })

  it('任意品质、任意转位：低音严格低于全部上方声部', () => {
    for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
      for (let inversion = 0; inversion < 4; inversion++) {
        const v = voiceChord(C(inversion, quality), 60)
        expect(v.bassMidi).toBeLessThan(Math.min(...v.upperMidis))
      }
    }
  })

  it('不改 chordToMidi 的既有行为（二转 C 和弦仍是向上旋转的 [67,72,76]）', () => {
    expect(chordToMidi(C(2), 60)).toEqual([67, 72, 76])
  })
})
