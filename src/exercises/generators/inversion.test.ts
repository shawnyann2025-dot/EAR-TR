import { describe, expect, it } from 'vitest'
import { QUALITY_INTERVALS } from '../../music/chord'
import { DEGREE_SEMITONES } from '../../music/key'
import { BASSLINE_PATTERNS, functionalChord } from '../data/chords'
import { DIFFICULTY_TABLE } from '../difficulty'
import { chordSlotSec, MIN_CHORD_SING_TARGETS } from './chordCommon'
import {
  BASSLINE_GENERATORS,
  INVERSION_GENERATORS,
  renderBassline,
  voicedChordMidis,
} from './inversion'
import { generatorInput } from './testInput'
import type { ContentResult } from '../types'

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const pc = (m: number) => ((m % 12) + 12) % 12
const allMidis = (r: ContentResult) => [
  ...r.notes.map((n) => n.midi),
  ...r.feedbackNotes.map((n) => n.midi),
  ...(r.format.kind === 'pitch' ? r.format.targets.map((t) => t.midi) : []),
]

describe('voicedChordMidis', () => {
  it('C 大调默认音区：V 的一转低音是 B，上方声部原位 G B D', () => {
    const inp = generatorInput('chord:inv-first', 'recognize')
    const v = voicedChordMidis({ ...functionalChord('major', 'V'), inversion: 1 }, inp)
    expect(v.upperMidis).toEqual([67, 71, 74])
    expect(v.bassMidi).toBe(59)
  })
})

describe('转位·听辨', () => {
  it('低音严格最低，且是目标转位指定的和弦音；选项含 root', () => {
    for (const [kp, inv, id] of [['chord:inv-first', 1, 'first'], ['chord:inv-second', 2, 'second']] as const) {
      for (const seed of SEEDS) {
        const r = INVERSION_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5, variationLevel: 6 }))
        const midis = r.notes.map((n) => n.midi)
        const bass = Math.min(...midis)
        expect(midis.filter((m) => m === bass)).toHaveLength(1)
        const upper = midis.filter((m) => m !== bass)
        const root = Math.min(...upper)
        expect(pc(bass - root)).toBe(QUALITY_INTERVALS.maj[inv])
        expect(r.answer).toEqual({ kind: 'choice', id })
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id).sort()).toEqual(['first', 'root', 'second'])
        expect(r.prompt).toBe('which-inversion')
      }
    }
  })
})

describe('转位·唱', () => {
  it('唱和弦的低音，1 个目标', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const r = INVERSION_GENERATORS.sing(generatorInput('chord:inv-second', 'sing', { seed, step: 5 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      expect(r.format.targets).toHaveLength(1)
      expect(r.format.targets[0].midi).toBe(Math.min(...r.notes.map((n) => n.midi)))
      expect(r.prompt).toBe('sing-bassline')
    }
  })
})

describe('转位·听写', () => {
  it('长度按档位，含目标转位，每个和弦的低音与答案一致', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = generatorInput('chord:inv-first', 'notate', { step, seed })
        const r = INVERSION_GENERATORS.notate(inp)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateChordCount[step])
        expect(ids).toContain('first')
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['first', 'root', 'second'])
        const slot = chordSlotSec(inp.resolved.bpm)
        ids.forEach((id, i) => {
          const chord = r.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          const bass = Math.min(...chord)
          const root = Math.min(...chord.filter((m) => m !== bass))
          const inv = { root: 0, first: 1, second: 2 }[id as 'root' | 'first' | 'second']
          expect(pc(bass - root)).toBe(QUALITY_INTERVALS.maj[inv])
        })
        expect(r.prompt).toBe('notate-inversions')
      }
    }
  })
})

describe('renderBassline', () => {
  it('每条模板：低音音级与 id 一致；低音逐步取最近八度（相邻 ≤ 6 半音）；低音严格低于同一和弦的上方声部', () => {
    for (const pattern of BASSLINE_PATTERNS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = generatorInput('chord:bassline', 'recognize', { seed, variationLevel: 6 })
        const out = renderBassline(pattern, inp)
        expect(out.bassDegrees.join('-')).toBe(pattern.id)
        out.bassMidis.forEach((m, i) => {
          expect(pc(m - inp.doMidi)).toBe(DEGREE_SEMITONES[out.bassDegrees[i]])
          if (i > 0) expect(Math.abs(m - out.bassMidis[i - 1])).toBeLessThanOrEqual(6)
        })
        const slot = chordSlotSec(inp.resolved.bpm)
        out.bassMidis.forEach((bass, i) => {
          const atStep = out.notes.filter((n) => Math.abs(n.atSec - i * slot) < 1e-9).map((n) => n.midi)
          expect(atStep).toContain(bass)
          expect(Math.min(...atStep.filter((m) => m !== bass))).toBeGreaterThan(bass)
        })
        expect(out.durSec).toBeCloseTo(4 * slot, 12)
      }
    }
  })
})

describe('低音线·三模态', () => {
  it('听辨：答案是被抽中的模板，选项来自模板 id', () => {
    const answers = new Set<string>()
    for (const seed of SEEDS) {
      const r = BASSLINE_GENERATORS.recognize(generatorInput('chord:bassline', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      answers.add(r.answer.id)
      expect(r.format.options.map((o) => o.id)).toContain(r.answer.id)
      for (const o of r.format.options) expect(BASSLINE_PATTERNS.map((p) => p.id)).toContain(o.id)
      expect(r.prompt).toBe('which-bass-contour')
    }
    expect(answers.size).toBeGreaterThan(1)
  })

  it('唱：前 N 个低音', () => {
    for (let step = 0; step <= 5; step++) {
      const r = BASSLINE_GENERATORS.sing(generatorInput('chord:bassline', 'sing', { step, seed: 3 }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      const n = Math.max(MIN_CHORD_SING_TARGETS, DIFFICULTY_TABLE.singTargetCount[step])
      const targets = r.format.targets
      expect(targets).toHaveLength(n)
      const bassIds = BASSLINE_PATTERNS.map((p) => p.id)
      expect(bassIds.some((id) => id.split('-').slice(0, n).join('-') === targets.map((t) => t.degree).join('-'))).toBe(true)
      expect(r.prompt).toBe('sing-bassline')
    }
  })

  it('听写：低音音级序列，字母表大调 7 音级', () => {
    const r = BASSLINE_GENERATORS.notate(generatorInput('chord:bassline', 'notate', { seed: 5 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(BASSLINE_PATTERNS.map((p) => p.id)).toContain(r.answer.ids.join('-'))
    expect(r.format.length).toBe(4)
    expect(r.format.alphabet.map((o) => o.id)).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'])
    expect(r.prompt).toBe('notate-bassline')
  })
})

describe('音区：整题落在 36–96，且移八度不改变转位', () => {
  it('任意变异与档位（含最低与最高音区）', () => {
    for (const [gens, kp] of [[INVERSION_GENERATORS, 'chord:inv-first'], [INVERSION_GENERATORS, 'chord:inv-second'], [BASSLINE_GENERATORS, 'chord:bassline']] as const) {
      for (const modality of ['recognize', 'sing', 'notate'] as const) {
        for (const seed of SEEDS) {
          const r = gens[modality](generatorInput(kp, modality, { seed, variationLevel: 6, step: seed % 6 }))
          for (const m of allMidis(r)) {
            expect(m).toBeGreaterThanOrEqual(36)
            expect(m).toBeLessThanOrEqual(96)
          }
        }
      }
    }
  })
})
