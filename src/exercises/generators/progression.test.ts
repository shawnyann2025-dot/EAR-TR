import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { requireChordEntry, type ProgressionEntry } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { chordSlotSec, MIN_CHORD_SING_TARGETS } from './chordCommon'
import { SING_NOTE_SEC } from './degree'
import {
  PROGRESSION_GENERATORS,
  functionalAlphabet,
  progressionCandidates,
  rotationIds,
} from './progression'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const entry = (kp: string) => requireChordEntry(kp) as ProgressionEntry
const input = (kp: string, modality: 'recognize' | 'sing' | 'notate', o: { step?: number; seed?: number; variationLevel?: number } = {}) =>
  generatorInput(kp, modality, { ...o, mode: entry(kp).mode })

describe('rotationIds / progressionCandidates（D8）', () => {
  it('除自身外的全部轮转', () => {
    expect(rotationIds(['i', 'VI', 'III', 'VII'])).toEqual(['VI-III-VII-i', 'III-VII-i-VI', 'VII-i-VI-III'])
  })

  it('池够时就是池', () => {
    expect(progressionCandidates(entry('prog:I-V-vi-IV'), ['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'], 3))
      .toEqual(['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'])
  })

  it('池不够时追加目标的轮转并去重（I-V-vi-IV 的轮转之一就是 vi-IV-I-V）', () => {
    const cands = progressionCandidates(entry('prog:I-V-vi-IV'), ['I-V-vi-IV', 'vi-IV-I-V', 'I-vi-IV-V'], Infinity)
    expect(new Set(cands).size).toBe(cands.length)
    expect(cands).toContain('V-vi-IV-I')
    expect(cands.filter((x) => x === 'vi-IV-I-V')).toHaveLength(1)
  })

  it('小调进行池只有自己，也至少给出 2 个候选', () => {
    expect(progressionCandidates(entry('prog:i-VI-III-VII'), ['i-VI-III-VII'], 2).length).toBeGreaterThanOrEqual(2)
  })
})

describe('functionalAlphabet', () => {
  it('大调进行（H5）：H2–H4 的 9 个大调功能和弦，不含副属与借用', () => {
    expect(functionalAlphabet(c, 'major', 'prog:I-V-vi-IV').sort()).toEqual(
      ['I', 'IV', 'V', 'vi', 'ii', 'V7', 'Imaj7', 'ii7', 'vi7'].sort(),
    )
  })

  it('小调进行（H7）：5 个小调功能和弦', () => {
    expect(functionalAlphabet(c, 'minor', 'prog:i-VI-III-VII').sort()).toEqual(['III', 'VI', 'VII', 'i', 'iv'])
  })
})

describe('进行·听辨', () => {
  it('放出进行的每个和弦（每个两拍）；答案与选项正确', () => {
    for (const kp of ['prog:I-V-vi-IV', 'prog:i-VI-III-VII']) {
      for (let step = 0; step <= 5; step++) {
        const inp = input(kp, 'recognize', { step, seed: step + 1 })
        const r = PROGRESSION_GENERATORS.recognize(inp)
        const slot = chordSlotSec(inp.resolved.bpm)
        expect(new Set(r.notes.map((n) => n.atSec))).toEqual(new Set([0, slot, 2 * slot, 3 * slot]))
        expect(r.answer).toEqual({ kind: 'choice', id: entry(kp).answerId })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toContain(entry(kp).answerId)
        expect(ids.length).toBeGreaterThanOrEqual(2)
        expect(new Set(ids).size).toBe(ids.length)
        expect(r.durSec).toBeCloseTo(4 * slot, 12)
        expect(r.prompt).toBe('which-progression')
      }
    }
  })
})

describe('进行·唱', () => {
  it('先放进行，目标是前 N 个和弦的根音', () => {
    for (let step = 0; step <= 5; step++) {
      const inp = input('prog:vi-IV-I-V', 'sing', { step })
      const r = PROGRESSION_GENERATORS.sing(inp)
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = Math.max(MIN_CHORD_SING_TARGETS, DIFFICULTY_TABLE.singTargetCount[step])
      expect(r.format.targets.map((t) => t.degree)).toEqual(['la', 'fa', 'do'].slice(0, n))
      expect(r.notes.length).toBeGreaterThan(0)
      const slot = chordSlotSec(inp.resolved.bpm)
      expect(r.durSec).toBeCloseTo(4 * slot + n * SING_NOTE_SEC, 12)
      expect(r.feedbackNotes.slice(-n).map((f) => f.midi)).toEqual(r.format.targets.map((t) => t.midi))
      expect(r.prompt).toBe('sing-bassline')
    }
  })
})

describe('进行·听写', () => {
  it('答案是进行本身，长度固定，不随档位变；字母表 = functionalAlphabet', () => {
    for (let step = 0; step <= 5; step++) {
      const r = PROGRESSION_GENERATORS.notate(input('prog:i-VI-III-VII', 'notate', { step }))
      if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
      expect(r.answer.ids).toEqual(['i', 'VI', 'III', 'VII'])
      expect(r.format.length).toBe(4)
      expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['III', 'VI', 'VII', 'i', 'iv'])
      expect(r.prompt).toBe('notate-progression')
    }
  })
})

describe('音区：整题落在 36–96', () => {
  it('任意变异与档位', () => {
    for (const kp of ['prog:I-V-vi-IV', 'prog:i-VI-III-VII']) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const r = PROGRESSION_GENERATORS[modality](input(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          const midis = [
            ...r.notes.map((n) => n.midi),
            ...r.feedbackNotes.map((n) => n.midi),
            ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
          ]
          for (const m of midis) {
            expect(m).toBeGreaterThanOrEqual(36)
            expect(m).toBeLessThanOrEqual(96)
          }
        }
      }
    }
  })
})
