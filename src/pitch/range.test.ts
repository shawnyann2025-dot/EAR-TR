import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate, type Exercise } from '../exercises/generate'
import { freqToMidi } from '../music/pitch'
import type { PlaybackPlan } from '../music/playback'
import { MIN_CONTEXT_MIDI, lowestMidi, VOICE_PRESETS, fitToRange, octaveShiftFor } from './range'

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

describe('搬移下限（P-4b 裁定）', () => {
  it('低音预设下，搬移后的计划里没有低于 MIDI 36 的事件（原本不低于 36 时）', () => {
    for (const kp of ['degree:major:ti', 'degree:major:do', 'chord:I']) {
      for (let cl = 0; cl <= 4; cl++) {
        for (let seed = 0; seed < 4; seed++) {
          let ex
          try {
            ex = generate({ kpId: kp, modality: 'sing', track: kp.startsWith('chord') ? 'H' : 'T', contextLevel: cl as never, variationLevel: 3, difficultyStep: 2, seed, segment: 'focus' }, c)
          } catch {
            continue
          }
          const lowest = (e: Exercise) =>
            Math.min(...[e.plan, e.feedback.replay, e.feedback.slow].flatMap((p) => p.events.map((x) => freqToMidi(x.freqHz))))
          const out = fitToRange(ex, VOICE_PRESETS.bass)
          if (lowest(ex) >= MIN_CONTEXT_MIDI) expect(lowest(out)).toBeGreaterThanOrEqual(MIN_CONTEXT_MIDI - 1e-6)
        }
      }
    }
  })
})

describe('鼓事件不参与音域换算', () => {
  const withDrums = (plan: PlaybackPlan): PlaybackPlan => ({
    ...plan,
    events: [{ atSec: 0, freqHz: 0, durSec: 0.1, timbreId: 'piano', gain: 1, drum: 'hat' }, ...plan.events],
  })
  it('lowestMidi 忽略鼓与零频率事件', () => {
    const e = sing(3)
    expect(lowestMidi([withDrums(e.plan)])).toBe(lowestMidi([e.plan]))
    expect(Number.isFinite(lowestMidi([withDrums(e.plan)]))).toBe(true)
  })
  it('fitToRange 对含鼓的计划结果与不含鼓一致，鼓保持不动', () => {
    const e = sing(3)
    const range = VOICE_PRESETS.bass
    const d: Exercise = { ...e, plan: withDrums(e.plan) }
    const out = fitToRange(d, range)
    expect(out.plan.events[0].freqHz).toBe(0)
    expect(out.plan.events.slice(1).map((x) => x.freqHz)).toEqual(fitToRange(e, range).plan.events.map((x) => x.freqHz))
  })
})
