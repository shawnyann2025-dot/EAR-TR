import { describe, expect, it } from 'vitest'
import type { Key } from '../music/key'
import { freqToMidi } from '../music/pitch'
import { notesToPlan } from '../music/playback'
import { doMidiForKey } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'
import {
  PLAN_MIDI_MAX,
  PLAN_MIDI_MIN,
  foldToPlanRange,
  shiftPlan,
  wrapWithTonalContext,
} from './context'

const C: Key = { tonic: 0, mode: 'major' }
const content = notesToPlan([{ midi: 64, atSec: 0, durSec: 0.8 }], 'piano')
const LEVELS: ContextLevel[] = [0, 1, 2, 3, 4]

describe('shiftPlan', () => {
  it('所有事件平移同一偏移，总时长随之增加，不修改输入', () => {
    const shifted = shiftPlan(content, 2)
    expect(shifted.events[0].atSec).toBe(2)
    expect(shifted.totalDurSec).toBeCloseTo(2.8, 12)
    expect(content.events[0].atSec).toBe(0)
  })
})

describe('wrapWithTonalContext', () => {
  for (const level of LEVELS) {
    it(`L${level}：题目内容紧接在 leadInSec 之后`, () => {
      const { plan, contentStartSec } = wrapWithTonalContext({
        key: C, level, timbreId: 'piano', doMidi: 60, content, contentDurSec: 0.8,
      })
      const expected = buildTonalContext({
        key: C, level, timbreId: 'piano', doMidi: 60, itemDurSec: 0.8,
      }).leadInSec
      expect(contentStartSec).toBe(expected)
      const target = plan.events.filter((e) => Math.abs(freqToMidi(e.freqHz) - 64) < 1e-6)
      expect(target.map((e) => e.atSec)).toContain(expected)
      expect(plan.totalDurSec).toBeGreaterThanOrEqual(contentStartSec + 0.8 - 1e-9)
    })
  }

  it('事件按时刻排序', () => {
    const { plan } = wrapWithTonalContext({
      key: C, level: 0, timbreId: 'piano', doMidi: 60, content, contentDurSec: 0.8,
    })
    const times = plan.events.map((e) => e.atSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('低音区的持续低音被折叠回 MIDI 36 以上（FWD-4 第二层）', () => {
    const B: Key = { tonic: 11, mode: 'major' }
    const doMidi = doMidiForKey(B, 48)
    for (const level of [2, 3, 4] as ContextLevel[]) {
      const { plan } = wrapWithTonalContext({
        key: B, level, timbreId: 'piano', doMidi, content, contentDurSec: 0.8,
      })
      for (const e of plan.events) {
        expect(freqToMidi(e.freqHz)).toBeGreaterThanOrEqual(PLAN_MIDI_MIN - 1e-6)
        expect(freqToMidi(e.freqHz)).toBeLessThanOrEqual(PLAN_MIDI_MAX + 1e-6)
      }
    }
  })

  it('空内容（唱模态）也能包装，contentStartSec 仍为 leadInSec', () => {
    const { contentStartSec } = wrapWithTonalContext({
      key: C, level: 3, timbreId: 'piano', doMidi: 60,
      content: notesToPlan([], 'piano'), contentDurSec: 2,
    })
    expect(contentStartSec).toBe(
      buildTonalContext({ key: C, level: 3, timbreId: 'piano', doMidi: 60, itemDurSec: 2 }).leadInSec,
    )
  })
})

describe('foldToPlanRange', () => {
  it('区间为 MIDI 36–96', () => {
    expect([PLAN_MIDI_MIN, PLAN_MIDI_MAX]).toEqual([36, 96])
    const folded = foldToPlanRange(notesToPlan([{ midi: 20, atSec: 0, durSec: 1 }], 'piano'))
    expect(freqToMidi(folded.events[0].freqHz)).toBeCloseTo(44, 9)
  })
})
