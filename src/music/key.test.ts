import { describe, expect, it } from 'vitest'
import {
  DEGREE_SEMITONES,
  SCALE_DEGREES,
  degreeToPitchClass,
  doReference,
  tonicDegree,
  type Key,
} from './key'

const C_MAJOR: Key = { tonic: 0, mode: 'major' }
const A_MINOR: Key = { tonic: 9, mode: 'minor' }
const E_MAJOR: Key = { tonic: 4, mode: 'major' }
const F_SHARP_MINOR: Key = { tonic: 6, mode: 'minor' }

describe('SCALE_DEGREES', () => {
  it('恰好覆盖 12 个音类，每个半音一个名字', () => {
    expect(SCALE_DEGREES).toHaveLength(12)
    const semitones = SCALE_DEGREES.map((d) => DEGREE_SEMITONES[d])
    expect([...semitones].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
  })
})

describe('doReference', () => {
  it('大调的 do 就是主音', () => {
    expect(doReference(C_MAJOR)).toBe(0)
    expect(doReference(E_MAJOR)).toBe(4)
  })

  it('小调用 la 基：do 落在关系大调主音上（主音上方小三度）', () => {
    // A 小调的关系大调是 C 大调，故 do = C = 0
    expect(doReference(A_MINOR)).toBe(0)
    // 升 F 小调的关系大调是 A 大调，故 do = A = 9
    expect(doReference(F_SHARP_MINOR)).toBe(9)
  })
})

describe('degreeToPitchClass', () => {
  it('C 大调：do=C, mi=E, sol=G, ti=B', () => {
    expect(degreeToPitchClass('do', C_MAJOR)).toBe(0)
    expect(degreeToPitchClass('mi', C_MAJOR)).toBe(4)
    expect(degreeToPitchClass('sol', C_MAJOR)).toBe(7)
    expect(degreeToPitchClass('ti', C_MAJOR)).toBe(11)
  })

  it('A 小调：la=A（主音）, do=C, mi=E', () => {
    expect(degreeToPitchClass('la', A_MINOR)).toBe(9)
    expect(degreeToPitchClass('do', A_MINOR)).toBe(0)
    expect(degreeToPitchClass('mi', A_MINOR)).toBe(4)
  })

  it('E 大调：sol=B, fa=A', () => {
    expect(degreeToPitchClass('sol', E_MAJOR)).toBe(11)
    expect(degreeToPitchClass('fa', E_MAJOR)).toBe(9)
  })

  it('结果始终落在 0–11', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        for (const degree of SCALE_DEGREES) {
          const pc = degreeToPitchClass(degree, { tonic, mode })
          expect(pc).toBeGreaterThanOrEqual(0)
          expect(pc).toBeLessThan(12)
        }
      }
    }
  })

  it('任意调下，12 个音级映射到 12 个互不相同的音类（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const pcs = SCALE_DEGREES.map((d) => degreeToPitchClass(d, { tonic, mode }))
        expect(new Set(pcs).size).toBe(12)
      }
    }
  })
})

describe('tonicDegree', () => {
  it('大调主音是 do，小调主音是 la', () => {
    expect(tonicDegree(C_MAJOR)).toBe('do')
    expect(tonicDegree(A_MINOR)).toBe('la')
  })

  it('主音音级解析回该调的主音音类（属性测试）', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key: Key = { tonic, mode }
        expect(degreeToPitchClass(tonicDegree(key), key)).toBe(tonic)
      }
    }
  })
})
