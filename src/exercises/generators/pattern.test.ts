import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { METERS, patternById, patternsOf } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import { PATTERN_GENERATORS, patternPassage } from './pattern'
import { barSec, patternsUpTo } from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)
const near = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length)
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9))
}

describe('patternPassage', () => {
  it('依次排列音型；小节数 = 各音型小节数之和；起音换算正确', () => {
    const input = generatorInput('rhythm:tie-across-bar', 'recognize')
    const bar = barSec(METERS['4/4'], input.resolved.bpm)
    const out = patternPassage([patternById('q-q-q-q'), patternById('q-q-q-e~q-q-q')], input)
    expect(out.bars).toHaveLength(3)
    near(out.onsets.map((o) => o.atSec / bar * 4), [0, 1, 2, 3, 4, 5, 6, 7.5, 9, 10, 11])
    expect(out.durSec).toBeCloseTo(3 * bar, 12)
    expect(out.onsets.filter((o) => o.accent).map((o) => o.atSec / bar)).toEqual([0, 1])
  })
})

describe('音型·听辨', () => {
  it('放出目标自己的音型之一；选项来自音型池并含答案；按拍号节拍器', () => {
    for (const kp of ['rhythm:quarter', 'rhythm:synco-8', 'rhythm:tie-across-bar']) {
      const own = patternsOf(kp).map((p) => p.id)
      const pool = patternsUpTo(c, kp).map((p) => p.id)
      for (const seed of SEEDS) {
        const r = PATTERN_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5 }))
        if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
        expect(own).toContain(r.answer.id)
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toContain(r.answer.id)
        for (const id of ids) expect(pool).toContain(id)
        expect(r.notes).toHaveLength(patternById(r.answer.id).notes.length)
        expect(r.rhythm?.metronome).toBe('metered')
        expect(r.rhythm?.bars).toHaveLength(patternById(r.answer.id).bars)
        expect(r.prompt).toBe('which-pattern')
      }
    }
  })

  it('选项与目标小节数相同：两小节题只给两小节选项，单小节题不出现两小节选项', () => {
    for (const kp of ['rhythm:tie-across-bar', 'rhythm:synco-16']) {
      for (const seed of SEEDS) {
        const r = PATTERN_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5 }))
        if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
        const bars = patternById(r.answer.id).bars
        for (const o of r.format.options) expect(patternById(o.id).bars).toBe(bars)
      }
    }
    const tie = PATTERN_GENERATORS.recognize(generatorInput('rhythm:tie-across-bar', 'recognize', { step: 5 }))
    if (tie.format.kind !== 'choice') throw new Error('格式错')
    expect(tie.format.options.map((o) => o.id).sort()).toEqual(['q-q-q-e|q-q-q-q', 'q-q-q-e~q-q-q'])
  })
})

describe('音型·打拍', () => {
  it('不放内容；按档位重复；起音、容差、显示用 patternIds 正确；反馈放出音型', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:dotted', 'sing', { step, seed: step + 1 })
      const r = PATTERN_GENERATORS.sing(input)
      if (r.format.kind !== 'tap' || r.answer.kind !== 'tap') throw new Error('格式错')
      expect(r.notes).toEqual([])
      const ids = r.format.patternIds ?? []
      const reps = DIFFICULTY_TABLE.tapBars[step]
      expect(ids).toHaveLength(reps)
      expect(new Set(ids).size).toBe(1)
      const p = patternById(ids[0])
      expect(patternsOf('rhythm:dotted').map((x) => x.id)).toContain(p.id)
      const bar = barSec(METERS['4/4'], input.resolved.bpm)
      const want = Array.from({ length: reps }, (_, k) => p.notes.map((n) => (k * 4 + n.onset) * bar / 4)).flat()
      near(r.format.onsetsSec, want)
      expect(r.answer.onsetsSec).toEqual(r.format.onsetsSec)
      expect(r.format.toleranceSec).toBe(DIFFICULTY_TABLE.tapToleranceSec[step])
      expect(r.feedbackNotes).toHaveLength(want.length)
      expect(r.prompt).toBe('tap-pattern')
    }
  })

  it('两小节音型：至少 1 遍，tapBars 为 2 时也只 1 遍', () => {
    const r = PATTERN_GENERATORS.sing(generatorInput('rhythm:tie-across-bar', 'sing', { step: 5 }))
    if (r.format.kind !== 'tap') throw new Error('格式错')
    expect(r.format.patternIds).toEqual(['q-q-q-e~q-q-q'])
  })
})

describe('音型·听写', () => {
  it('个数按档位，含目标自己的音型，字母表 = 音型池；起音与答案一致', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const input = generatorInput('rhythm:sixteenth', 'notate', { step, seed })
        const r = PATTERN_GENERATORS.notate(input)
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateRhythmBars[step])
        expect(ids.some((id) => patternsOf('rhythm:sixteenth').map((p) => p.id).includes(id))).toBe(true)
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(patternsUpTo(c, 'rhythm:sixteenth').map((p) => p.id).sort())
        const passage = patternPassage(ids.map(patternById), input)
        near(r.notes.map((n) => n.atSec), passage.onsets.map((o) => o.atSec))
        expect(r.prompt).toBe('notate-patterns')
      }
    }
  })
})
