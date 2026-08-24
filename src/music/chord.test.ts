import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS, chordToMidi, diatonicChord, type Chord } from './chord'
import type { Key } from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }

describe('chordToMidi', () => {
  it('do 上的大三和弦、do=60 → [60, 64, 67]', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([60, 64, 67])
  })

  it('la 上的小三和弦、do=60 → [69, 72, 76]', () => {
    const chord: Chord = { rootDegree: 'la', quality: 'min', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([69, 72, 76])
  })

  it('sol 上的属七和弦 → [67, 71, 74, 77]', () => {
    const chord: Chord = { rootDegree: 'sol', quality: 'dom7', inversion: 0 }
    expect(chordToMidi(chord, 60)).toEqual([67, 71, 74, 77])
  })

  it('第一转位把根音升八度移到顶部', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 1 }
    expect(chordToMidi(chord, 60)).toEqual([64, 67, 72])
  })

  it('第二转位再移一个', () => {
    const chord: Chord = { rootDegree: 'do', quality: 'maj', inversion: 2 }
    expect(chordToMidi(chord, 60)).toEqual([67, 72, 76])
  })

  it('转位不改变音类集合（属性测试）', () => {
    const base: Chord = { rootDegree: 'fa', quality: 'maj7', inversion: 0 }
    const pcs = (ms: number[]) => new Set(ms.map((m) => ((m % 12) + 12) % 12))
    const expected = pcs(chordToMidi(base, 60))
    for (const inversion of [1, 2, 3]) {
      expect(pcs(chordToMidi({ ...base, inversion }, 60))).toEqual(expected)
    }
  })

  it('音符始终按音高升序排列（属性测试）', () => {
    for (const quality of Object.keys(QUALITY_INTERVALS) as (keyof typeof QUALITY_INTERVALS)[]) {
      for (let inversion = 0; inversion < 4; inversion++) {
        const notes = chordToMidi({ rootDegree: 'do', quality, inversion }, 60)
        const sorted = [...notes].sort((a, b) => a - b)
        expect(notes).toEqual(sorted)
      }
    }
  })
})

describe('diatonicChord', () => {
  it('C 大调级数：I 大、ii 小、V 大、vii 减', () => {
    expect(diatonicChord(C_MAJOR, 1)).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 2)).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 5)).toEqual({ rootDegree: 'sol', quality: 'maj', inversion: 0 })
    expect(diatonicChord(C_MAJOR, 7)).toEqual({ rootDegree: 'ti', quality: 'dim', inversion: 0 })
  })

  it('A 小调级数（la 基）：i 小、III 大、iv 小、VI 大', () => {
    expect(diatonicChord(A_MINOR, 1)).toEqual({ rootDegree: 'la', quality: 'min', inversion: 0 })
    expect(diatonicChord(A_MINOR, 3)).toEqual({ rootDegree: 'do', quality: 'maj', inversion: 0 })
    expect(diatonicChord(A_MINOR, 4)).toEqual({ rootDegree: 're', quality: 'min', inversion: 0 })
    expect(diatonicChord(A_MINOR, 6)).toEqual({ rootDegree: 'fa', quality: 'maj', inversion: 0 })
  })

  it('小调 I 级的根音解析回该调主音', () => {
    const chord = diatonicChord(A_MINOR, 1)
    expect(chordToMidi(chord, 60)[0] % 12).toBe(9)
  })

  it('转位参数被透传', () => {
    expect(diatonicChord(C_MAJOR, 4, 1).inversion).toBe(1)
  })
})
