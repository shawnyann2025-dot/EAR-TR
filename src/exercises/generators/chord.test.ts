import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS } from '../../music/chord'
import { midiToFreq } from '../../music/pitch'
import { requireChordEntry, functionalChord } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { PLAN_MIDI_MAX, PLAN_MIDI_MIN } from '../context'
import { chordSlotSec } from './chordCommon'
import { FUNCTIONAL_GENERATORS, QUALITY_GENERATORS } from './chord'
import { SING_NOTE_SEC } from './degree'
import { generatorInput } from './testInput'
import type { ContentResult } from '../types'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const pc = (m: number) => ((m % 12) + 12) % 12
const intervalsFromLowest = (midis: number[]) => {
  const s = [...midis].sort((a, b) => a - b)
  return s.map((m) => m - s[0])
}
const modeOf = (kp: string) => requireChordEntry(kp).mode
const input = (kp: string, modality: 'recognize' | 'sing' | 'notate', o: { step?: number; seed?: number; variationLevel?: number } = {}) =>
  generatorInput(kp, modality, { ...o, mode: modeOf(kp) })
const allMidis = (r: ContentResult) => [
  ...r.notes.map((n) => n.midi),
  ...r.feedbackNotes.map((n) => n.midi),
  ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
]

describe('品质·听辨', () => {
  it('放一个目标品质的原位和弦；选项是 maj/min 的子集且含答案', () => {
    for (const kp of ['chord:quality-maj', 'chord:quality-min'] as const) {
      const quality = kp.endsWith('maj') ? 'maj' : 'min'
      for (const seed of SEEDS) {
        const r = QUALITY_GENERATORS.recognize(input(kp, 'recognize', { seed }))
        expect(intervalsFromLowest(r.notes.map((n) => n.midi))).toEqual([...QUALITY_INTERVALS[quality]])
        expect(r.answer).toEqual({ kind: 'choice', id: quality })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id).sort()).toEqual(['maj', 'min'])
        expect(r.prompt).toBe('which-quality')
      }
    }
  })

  it('variationLevel 6 时会出现琶音呈现（起音时刻不全相同）', () => {
    const arpeggiated = SEEDS.some((seed) => {
      const r = QUALITY_GENERATORS.recognize(input('chord:quality-maj', 'recognize', { seed, variationLevel: 6 }))
      return new Set(r.notes.map((n) => n.atSec)).size > 1
    })
    expect(arpeggiated).toBe(true)
  })
})

describe('品质·唱', () => {
  it('先放根音；目标是从根音起的琶音前 N 个音', () => {
    for (let step = 0; step <= 5; step++) {
      const r = QUALITY_GENERATORS.sing(input('chord:quality-min', 'sing', { step, seed: step + 1 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = DIFFICULTY_TABLE.singTargetCount[step]
      const t = r.format.targets
      expect(t).toHaveLength(n)
      expect(r.notes).toHaveLength(1)
      expect(r.notes[0].midi).toBe(t[0].midi)
      expect(t.map((x) => x.midi - t[0].midi)).toEqual(QUALITY_INTERVALS.min.slice(0, n))
      for (const x of t) {
        expect(x.freqHz).toBeCloseTo(midiToFreq(x.midi), 9)
        expect(x.centsTolerance).toBe(50)
      }
      expect(r.feedbackNotes.map((f) => f.midi)).toEqual(t.map((x) => x.midi))
      expect(r.durSec).toBeCloseTo(SING_NOTE_SEC * (1 + n), 12)
      expect(r.prompt).toBe('sing-arpeggio')
    }
  })
})

describe('品质·听写', () => {
  it('长度按档位，含目标品质，答案与实际和弦一一对应', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input('chord:quality-maj', 'notate', { step, seed })
        const r = QUALITY_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const len = DIFFICULTY_TABLE.notateChordCount[step]
        expect(r.answer.ids).toHaveLength(len)
        expect(r.answer.ids).toContain('maj')
        expect(r.format.alphabet.map((o) => o.id)).toEqual(['maj', 'min'])
        const slot = chordSlotSec(inp.resolved.bpm)
        r.answer.ids.forEach((q, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          expect(intervalsFromLowest(chord)).toEqual([...QUALITY_INTERVALS[q as 'maj' | 'min']])
        })
        expect(r.prompt).toBe('notate-qualities')
      }
    }
  })
})

describe('功能和弦·听辨', () => {
  it('C 大调默认音区下 V 是 [67,71,74]；选项来自干扰池', () => {
    const r = FUNCTIONAL_GENERATORS.recognize(input('chord:V', 'recognize', { step: 5 }))
    expect(r.notes.map((n) => n.midi)).toEqual([67, 71, 74])
    expect(r.answer).toEqual({ kind: 'choice', id: 'V' })
    if (r.format.kind !== 'choice') throw new Error('格式错')
    expect(r.format.options.map((o) => o.id).sort()).toEqual(['I', 'IV', 'V'])
    expect(r.prompt).toBe('which-chord')
  })

  it('a 小调默认音区下 i 以主音 la 为根：[57,60,64]', () => {
    const r = FUNCTIONAL_GENERATORS.recognize(input('chord:i', 'recognize'))
    expect(r.notes.map((n) => n.midi)).toEqual([57, 60, 64])
  })

  it('音级类与目标和弦一致（任意 seed、任意变异等级）', () => {
    for (const kp of ['chord:ii7', 'chord:borrowed-bVII', 'chord:VI']) {
      const e = requireChordEntry(kp)
      if (e.family !== 'functional') throw new Error('不是功能和弦')
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input(kp, 'recognize', { seed, variationLevel: 6 })
        const r = FUNCTIONAL_GENERATORS.recognize(inp)
        expect(intervalsFromLowest(r.notes.map((n) => n.midi))).toEqual([...QUALITY_INTERVALS[e.chord.quality]])
      }
    }
  })
})

describe('功能和弦·唱', () => {
  it('不放内容；目标是该和弦琶音前 N 个音', () => {
    const r = FUNCTIONAL_GENERATORS.sing(input('chord:V7', 'sing', { step: 5 }))
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.format.targets.map((t) => t.degree)).toEqual(['sol', 'ti', 're'])
    expect(r.format.targets.map((t) => pc(t.midi))).toEqual([7, 11, 2])
    expect(r.prompt).toBe('sing-arpeggio')
  })
})

describe('功能和弦·听写', () => {
  it('首个是主和弦，含目标，相邻不重复，字母表 = 干扰池，和弦与答案一一对应', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input('chord:vi', 'notate', { step, seed })
        const r = FUNCTIONAL_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateChordCount[step])
        expect(ids[0]).toBe('I')
        expect(ids).toContain('vi')
        for (let i = 1; i < ids.length; i++) {
          expect(ids[i]).not.toBe(ids[i - 1])
        }
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['I', 'IV', 'V', 'ii', 'vi'].sort())
        const slot = chordSlotSec(inp.resolved.bpm)
        ids.forEach((id, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => pc(n.midi)).sort((a, b) => a - b)
          const ch = functionalChord('major', id)
          const want = QUALITY_INTERVALS[ch.quality]
            .map((iv) => pc(inp.doMidi + ({ do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, ti: 11 } as Record<string, number>)[ch.rootDegree] + iv))
            .sort((a, b) => a - b)
          expect(chord).toEqual(want)
        })
        expect(r.prompt).toBe('notate-chords')
      }
    }
  })
})

describe('音区：整题落在 36–96（不依赖逐音折叠）', () => {
  it('任意变异与档位', () => {
    for (const kp of ['chord:quality-maj', 'chord:V7', 'chord:Imaj7', 'chord:VII']) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const gens = kp.includes('quality') ? QUALITY_GENERATORS : FUNCTIONAL_GENERATORS
          const r = gens[modality](input(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          for (const m of allMidis(r)) {
            expect(m).toBeGreaterThanOrEqual(PLAN_MIDI_MIN)
            expect(m).toBeLessThanOrEqual(PLAN_MIDI_MAX)
          }
        }
      }
    }
  })
})
