import { describe, expect, it } from 'vitest'
import { planEndSec, planToVoices } from './voices'
import { emptyPlan, notesToPlan } from '../music/playback'
import { TIMBRES } from './timbres'

const PLAN = notesToPlan(
  [
    { midi: 60, atSec: 0, durSec: 1 },
    { midi: 64, atSec: 1, durSec: 0.5 },
  ],
  'piano',
)

describe('planToVoices', () => {
  it('每个事件产生一个声部', () => {
    expect(planToVoices(PLAN, 0)).toHaveLength(2)
  })

  it('起点偏移加到每个声部上', () => {
    const voices = planToVoices(PLAN, 10)
    expect(voices[0].startSec).toBeCloseTo(10, 10)
    expect(voices[1].startSec).toBeCloseTo(11, 10)
  })

  it('stopSec 在事件时值之外还留出释音时间', () => {
    const voices = planToVoices(PLAN, 0)
    const release = TIMBRES.piano.env.releaseSec
    expect(voices[0].stopSec).toBeCloseTo(1 + release, 10)
  })

  it('声部携带对应的音色定义', () => {
    expect(planToVoices(PLAN, 0)[0].timbre).toBe(TIMBRES.piano)
  })

  it('频率与增益原样透传', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1, gain: 0.4 }], 'voice')
    const v = planToVoices(plan, 0)[0]
    expect(v.freqHz).toBeCloseTo(440, 6)
    expect(v.gain).toBe(0.4)
  })

  it('stopSec 始终晚于 startSec（属性测试）', () => {
    for (const timbreId of ['piano', 'strings', 'voice', 'electronic'] as const) {
      const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 0.01 }], timbreId)
      const v = planToVoices(plan, 0)[0]
      expect(v.stopSec).toBeGreaterThan(v.startSec)
    }
  })

  it('空计划产生零个声部', () => {
    expect(planToVoices(emptyPlan(), 0)).toEqual([])
  })
})

describe('planEndSec', () => {
  it('返回最晚声部的停止时刻', () => {
    const end = planEndSec(PLAN, 0)
    expect(end).toBeCloseTo(1.5 + TIMBRES.piano.env.releaseSec, 10)
  })

  it('空计划的结束时刻等于起点', () => {
    expect(planEndSec(emptyPlan(), 5)).toBe(5)
  })
})
