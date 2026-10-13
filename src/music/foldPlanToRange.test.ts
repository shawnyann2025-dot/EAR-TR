import { describe, expect, it } from 'vitest'
import { freqToMidi, midiToFreq } from './pitch'
import { notesToPlan } from './playback'
import { foldPlanToRange } from './register'

const planOf = (...midis: number[]) =>
  notesToPlan(
    midis.map((midi, i) => ({ midi, atSec: i, durSec: 0.5 })),
    'piano',
  )

describe('freqToMidi', () => {
  it('是 midiToFreq 的反函数', () => {
    for (const m of [21, 36, 60, 69, 96, 108]) {
      expect(freqToMidi(midiToFreq(m))).toBeCloseTo(m, 9)
    }
  })
})

describe('foldPlanToRange（FWD-4：整份 plan 的八度折叠）', () => {
  it('低于下限的音按八度上移，直到落入区间', () => {
    const folded = foldPlanToRange(planOf(18), 36, 96)
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(42, 9)
  })

  it('高于上限的音按八度下移', () => {
    const folded = foldPlanToRange(planOf(100), 36, 96)
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(88, 9)
  })

  it('区间内的音与边界上的音不动', () => {
    const plan = planOf(36, 60, 96)
    const folded = foldPlanToRange(plan, 36, 96)
    expect(folded.events.map((e) => e.freqHz)).toEqual(plan.events.map((e) => e.freqHz))
  })

  it('只改频率，时刻、时值、音色、gain、totalDurSec 不变', () => {
    const plan = planOf(18, 100)
    const folded = foldPlanToRange(plan, 36, 96)
    expect(folded.totalDurSec).toBe(plan.totalDurSec)
    for (let i = 0; i < plan.events.length; i++) {
      expect(folded.events[i].atSec).toBe(plan.events[i].atSec)
      expect(folded.events[i].durSec).toBe(plan.events[i].durSec)
      expect(folded.events[i].timbreId).toBe(plan.events[i].timbreId)
      expect(folded.events[i].gain).toBe(plan.events[i].gain)
    }
  })

  it('不修改输入', () => {
    const plan = planOf(18)
    const before = plan.events[0].freqHz
    foldPlanToRange(plan, 36, 96)
    expect(plan.events[0].freqHz).toBe(before)
  })

  it('区间窄于一个八度时抛错（否则可能无解）', () => {
    expect(() => foldPlanToRange(planOf(60), 60, 70)).toThrow()
  })
})
