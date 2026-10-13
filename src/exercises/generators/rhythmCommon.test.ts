import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { makeRng } from '../../music/rng'
import { ACCENT_OFF_FACTOR, type Meter } from '../../music/rhythm'
import { METERS } from '../data/rhythms'
import {
  RHYTHM_LEGATO,
  barSec,
  barStartTimes,
  barsDurSec,
  contentMidi,
  notesAsPlacedEvents,
  patternsUpTo,
  placedToOnsets,
  randomPulseFill,
  rhythmNotes,
  unitSec,
} from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const M44: Meter = METERS['4/4']
const M68: Meter = METERS['6/8']

describe('时间换算（bpm 是感知拍，FWD-6）', () => {
  it('4/4 一个四分音符 = 一拍；6/8 一个八分音符 = 三分之一拍', () => {
    expect(unitSec(M44, 60)).toBe(1)
    expect(unitSec(M68, 60)).toBeCloseTo(1 / 3, 12)
    expect(barSec(M68, 60)).toBeCloseTo(2, 12)
    expect(barSec(METERS['3/4'], 120)).toBeCloseTo(1.5, 12)
  })

  it('小节起点与总时长', () => {
    expect(barStartTimes([M44, METERS['3/4'], M44], 60)).toEqual([0, 4, 7])
    expect(barsDurSec([M44, METERS['3/4']], 60)).toBe(7)
  })
})

describe('placedToOnsets', () => {
  it('按小节起点与单位秒数换算，时值乘 RHYTHM_LEGATO，按时刻排序', () => {
    const onsets = placedToOnsets(
      [
        { bar: 1, onsetUnits: 0, durUnits: 1, accent: true },
        { bar: 0, onsetUnits: 2.5, durUnits: 0.5, accent: false },
      ],
      [M44, M44],
      60,
    )
    expect(onsets).toEqual([
      { atSec: 2.5, durSec: 0.5 * RHYTHM_LEGATO, accent: false },
      { atSec: 4, durSec: RHYTHM_LEGATO, accent: true },
    ])
  })
})

describe('rhythmNotes（FWD-2 力度规则）', () => {
  it('音高是主音；重音 gain = velocity，非重音 × ACCENT_OFF_FACTOR', () => {
    const input = generatorInput('rhythm:quarter', 'recognize')
    const notes = rhythmNotes(
      [{ atSec: 0, durSec: 0.5, accent: true }, { atSec: 1, durSec: 0.5, accent: false }],
      input,
    )
    expect(notes.every((x) => x.midi === contentMidi(input))).toBe(true)
    expect(notes[0].gain).toBeCloseTo(input.resolved.velocity, 12)
    expect(notes[1].gain).toBeCloseTo(input.resolved.velocity * ACCENT_OFF_FACTOR, 12)
  })
})

describe('notesAsPlacedEvents', () => {
  it('四分音符单位、可跨小节；小节第一拍上的音加重', () => {
    const ev = notesAsPlacedEvents([{ onset: 0, dur: 1 }, { onset: 3.5, dur: 1.5 }, { onset: 5, dur: 1 }], 2, true)
    expect(ev).toEqual([
      { bar: 2, onsetUnits: 0, durUnits: 1, accent: true },
      { bar: 2, onsetUnits: 3.5, durUnits: 1.5, accent: false },
      { bar: 3, onsetUnits: 1, durUnits: 1, accent: false },
    ])
  })

  it('accentDownbeats=false 时全部不加重（弱起）', () => {
    expect(notesAsPlacedEvents([{ onset: 0, dur: 1 }], 0, false)[0].accent).toBe(false)
  })
})

describe('randomPulseFill', () => {
  it('铺满一小节、首尾相接；只有第一个音加重；x/4 细分为两个八分，6/8 细分为三个八分', () => {
    for (const meter of [METERS['2/4'], METERS['3/4'], M44, M68]) {
      for (let s = 1; s <= 30; s++) {
        const ev = randomPulseFill(meter, 0, makeRng(s))
        expect(ev[0].onsetUnits).toBe(0)
        for (let i = 1; i < ev.length; i++) {
          expect(ev[i].onsetUnits).toBeCloseTo(ev[i - 1].onsetUnits + ev[i - 1].durUnits, 12)
        }
        const last = ev[ev.length - 1]
        expect(last.onsetUnits + last.durUnits).toBeCloseTo(meter.beatsPerBar, 12)
        expect(ev.filter((e) => e.accent)).toEqual([ev[0]])
        const sizes = new Set(ev.map((e) => e.durUnits))
        for (const d of sizes) expect(meter.beatUnit === 8 ? [1, 3] : [0.5, 1]).toContain(d)
      }
    }
  })

  it('fromPulse：从小节中间开始填，前面空着，且不加重', () => {
    const ev = randomPulseFill(M44, 0, makeRng(3), 2)
    expect(ev[0].onsetUnits).toBe(2)
    expect(ev.some((e) => e.accent)).toBe(false)
  })

  it('不同 seed 填法不同', () => {
    const keys = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(randomPulseFill(M44, 0, makeRng(s + 1)))))
    expect(keys.size).toBeGreaterThan(1)
  })
})

describe('patternsUpTo', () => {
  it('quarter（R2）：只有 R2 的四分与八分音型', () => {
    expect(patternsUpTo(c, 'rhythm:quarter').map((p) => p.ownerKpId).sort()).toEqual(
      ['rhythm:eighth-pair', 'rhythm:eighth-pair', 'rhythm:quarter', 'rhythm:quarter'],
    )
  })

  it('anacrusis（R7）：含连线；singleBarOnly 时去掉两小节音型', () => {
    expect(patternsUpTo(c, 'rhythm:anacrusis').some((p) => p.bars === 2)).toBe(true)
    expect(patternsUpTo(c, 'rhythm:anacrusis', { singleBarOnly: true }).every((p) => p.bars === 1)).toBe(true)
  })

  it('beat-one（R1）：还没有任何音型', () => {
    expect(patternsUpTo(c, 'rhythm:beat-one')).toEqual([])
  })
})
