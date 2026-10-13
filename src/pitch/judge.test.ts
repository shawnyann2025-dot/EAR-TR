import { describe, expect, it } from 'vitest'
import type { PitchTarget } from '../exercises/types'
import { midiToFreq } from '../music/pitch'
import { centsBetween, foldCents, judgeSung } from './judge'

const target = (midi: number): PitchTarget => ({ degree: 'do', midi, freqHz: midiToFreq(midi), centsTolerance: 50 })
const at = (midi: number, cents = 0) => midiToFreq(midi) * Math.pow(2, cents / 1200)

describe('foldCents（主 spec §9.3）', () => {
  it('结果在 [-600, 600)，整八度折到 0', () => {
    expect(foldCents(0)).toBe(0)
    expect(foldCents(1200)).toBe(0)
    expect(foldCents(-2400)).toBe(0)
    expect(foldCents(1230)).toBeCloseTo(30)
    expect(foldCents(-1170)).toBeCloseTo(30)
    expect(foldCents(600)).toBe(-600)
  })
  it('centsBetween', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200)
  })
})

describe('judgeSung（P-4 spec D2）', () => {
  const ts = [target(60), target(64), target(67)]

  it('全部在 ±50 音分内才对', () => {
    const r = judgeSung(ts, [at(60, 10), at(64, -49), at(67, 49)])
    expect(r.correct).toBe(true)
    expect(r.perTarget).toEqual([true, true, true])
    expect(r.centsOff[1]).toBeCloseTo(-49, 5)
  })

  it('偏 51 音分判错', () => {
    const r = judgeSung(ts, [at(60), at(64, 51), at(67)])
    expect(r.correct).toBe(false)
    expect(r.perTarget).toEqual([true, false, true])
  })

  it('八度折叠：低一个、两个八度，高一个八度都判对', () => {
    expect(judgeSung(ts, [at(48), at(52), at(55)]).correct).toBe(true)
    expect(judgeSung(ts, [at(36), at(40), at(43)]).correct).toBe(true)
    expect(judgeSung(ts, [at(72), at(76), at(79)]).correct).toBe(true)
  })

  it('段数不足：缺的记错、centsOff 为 null', () => {
    const r = judgeSung(ts, [at(60), at(64)])
    expect(r.correct).toBe(false)
    expect(r.perTarget).toEqual([true, true, false])
    expect(r.centsOff[2]).toBeNull()
  })

  it('多唱的段忽略；顺序错了判错', () => {
    expect(judgeSung(ts, [at(60), at(64), at(67), at(72)]).correct).toBe(true)
    expect(judgeSung(ts, [at(64), at(60), at(67)]).correct).toBe(false)
  })

  it('什么都没唱：全错', () => {
    const r = judgeSung(ts, [])
    expect(r).toEqual({ correct: false, perTarget: [false, false, false], centsOff: [null, null, null] })
  })
})

describe('judgeSung：坏输入', () => {
  it('非有限或非正的频率按没唱到处理（centsOff 为 null）', () => {
    const r = judgeSung([target(60), target(64)], [Number.NaN, 0])
    expect(r).toEqual({ correct: false, perTarget: [false, false], centsOff: [null, null] })
    expect(judgeSung([target(60)], [Number.POSITIVE_INFINITY]).centsOff).toEqual([null])
  })
})
