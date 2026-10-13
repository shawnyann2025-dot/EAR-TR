import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate, type Exercise } from '../exercises/generate'
import { VOICE_PRESETS, fitToRange, octaveShiftFor } from './range'

const c = buildCurriculum()
const sing = (seed: number): Exercise =>
  generate({ kpId: 'degree:major:sol', modality: 'sing', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed, segment: 'focus' }, c)
const recognize = generate({ kpId: 'degree:major:sol', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 1, segment: 'focus' }, c)

describe('VOICE_PRESETS（P-4 spec §3.5）', () => {
  it('四个声部的 MIDI 范围', () => {
    expect(VOICE_PRESETS.bass).toMatchObject({ lowMidi: 41, highMidi: 62 })
    expect(VOICE_PRESETS.tenor).toMatchObject({ lowMidi: 48, highMidi: 69 })
    expect(VOICE_PRESETS.alto).toMatchObject({ lowMidi: 53, highMidi: 74 })
    expect(VOICE_PRESETS.soprano).toMatchObject({ lowMidi: 60, highMidi: 81 })
  })
})

describe('octaveShiftFor', () => {
  it('取使目标中点最接近音域中点的整八度', () => {
    expect(octaveShiftFor([72, 76], { lowMidi: 41, highMidi: 62 })).toBe(-2)
    expect(octaveShiftFor([60, 64], { lowMidi: 53, highMidi: 74 })).toBe(0)
    expect(octaveShiftFor([48], { lowMidi: 60, highMidi: 81 })).toBe(2)
  })
})

describe('fitToRange（P-4 spec D4）', () => {
  it('无音域或非唱题：原样返回同一对象', () => {
    const ex = sing(1)
    expect(fitToRange(ex, null)).toBe(ex)
    expect(fitToRange(recognize, VOICE_PRESETS.bass)).toBe(recognize)
  })

  it('整题按整八度移动：目标、播放、反馈一起移，时间不变；不修改输入', () => {
    for (let seed = 0; seed < 10; seed++) {
      const ex = sing(seed)
      if (ex.answer.kind !== 'pitch' || ex.format.kind !== 'pitch') throw new Error('应为唱题')
      const before = JSON.stringify(ex)
      const range = VOICE_PRESETS.bass
      const out = fitToRange(ex, range)
      expect(JSON.stringify(ex)).toBe(before)
      if (out.answer.kind !== 'pitch' || out.format.kind !== 'pitch') throw new Error()
      const k = octaveShiftFor(ex.answer.targets.map((t) => t.midi), range)
      const ratio = Math.pow(2, k)
      out.answer.targets.forEach((t, i) => {
        expect(t.midi).toBe((ex.answer as { targets: { midi: number }[] }).targets[i].midi + 12 * k)
        expect(t.freqHz).toBeCloseTo((ex.answer as { targets: { freqHz: number }[] }).targets[i].freqHz * ratio, 6)
      })
      expect(out.format.targets).toEqual(out.answer.targets)
      for (const [a, b] of [[out.plan, ex.plan], [out.feedback.replay, ex.feedback.replay], [out.feedback.slow, ex.feedback.slow]] as const) {
        expect(a.events.map((e) => e.atSec)).toEqual(b.events.map((e) => e.atSec))
        a.events.forEach((e, i) => expect(e.freqHz).toBeCloseTo(b.events[i].freqHz * ratio, 6))
      }
      // 目标中点落在音域内
      const mids = out.answer.targets.map((t) => t.midi)
      const mid = (Math.min(...mids) + Math.max(...mids)) / 2
      expect(mid).toBeGreaterThanOrEqual(range.lowMidi - 6)
      expect(mid).toBeLessThanOrEqual(range.highMidi + 6)
    }
  })
})
