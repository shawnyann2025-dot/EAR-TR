import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { MODALITIES } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'
import { freqToMidi } from '../music/pitch'
import { makeRng } from '../music/rng'
import type { ContextLevel } from '../music/tonalContext'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { PLAN_MIDI_MAX, PLAN_MIDI_MIN } from './context'
import { CHORD_ENTRIES } from './data/chords'
import { DEGREE_ENTRIES } from './data/degrees'
import { answerAsResponse, generate, grade, lookupGenerator } from './generate'
import type { Exercise } from './types'
import { doMidiFor, resolveVariation } from './variation'

const c = buildCurriculum()

function spec(overrides: Partial<ExerciseSpec>): ExerciseSpec {
  return {
    kpId: 'degree:major:re',
    modality: 'recognize',
    track: 'T',
    contextLevel: 0,
    variationLevel: 0,
    difficultyStep: 0,
    seed: 1,
    segment: 'focus',
    ...overrides,
  }
}

const TH_ROWS: { kpId: string; track: 'T' | 'H' }[] = [
  ...DEGREE_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'T' as const })),
  ...CHORD_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'H' as const })),
]
const pickTH = (rng: { pick<T>(xs: readonly T[]): T }) => rng.pick(TH_ROWS)

/** 覆盖全部 T/H 轨知识点 × 模态 × 语境 × 变异 × 档位的随机规格 */
function randomSpecs(n: number): ExerciseSpec[] {
  const rng = makeRng(20261013)
  return Array.from({ length: n }, () =>
    spec({
      ...pickTH(rng),
      modality: rng.pick(MODALITIES),
      contextLevel: rng.int(5) as ContextLevel,
      variationLevel: rng.int(7) as VariationLevel,
      difficultyStep: rng.int(6),
      seed: rng.int(2 ** 31),
    }),
  )
}

const allMidis = (ex: Exercise) =>
  [ex.plan, ex.feedback.replay, ex.feedback.slow].flatMap((p) => p.events.map((e) => freqToMidi(e.freqHz)))

describe('lookupGenerator', () => {
  it('每个 T 轨知识点都有生成器；转调走转调分支', () => {
    for (const e of DEGREE_ENTRIES) expect(lookupGenerator(e.kpId)).toBeDefined()
    expect(lookupGenerator('degree:modulation:shift')?.byModality.recognize).not.toBe(
      lookupGenerator('degree:major:do')?.byModality.recognize,
    )
  })

  it('每个 H 轨知识点都有生成器；R 轨在 P-2b-R 之前尚无生成器', () => {
    for (const e of CHORD_ENTRIES) expect(lookupGenerator(e.kpId)).toBeDefined()
    expect(lookupGenerator('chord:i')?.mode).toBe('minor')
    expect(lookupGenerator('rhythm:quarter')).toBeUndefined()
  })
})

describe('generate：管线', () => {
  it('题目内容紧接语境之后，且确实出现在 plan 里', () => {
    const ex = generate(spec({ contextLevel: 1 }), c)
    expect(ex.contentStartSec).toBeGreaterThan(0)
    expect(ex.plan.events.some((e) => Math.abs(e.atSec - ex.contentStartSec) < 1e-9)).toBe(true)
  })

  it('携带输入规格与解析后的变异', () => {
    const s = spec({ variationLevel: 3, seed: 42 })
    const ex = generate(s, c)
    expect(ex.spec).toEqual(s)
    expect(ex.resolved.key.mode).toBe('major')
  })

  it('小调知识点用小调', () => {
    expect(generate(spec({ kpId: 'degree:minor:do' }), c).resolved.key).toEqual({ tonic: 9, mode: 'minor' })
  })

  it('反馈 replay 以主音开头', () => {
    const ex = generate(spec({}), c)
    expect(freqToMidi(ex.feedback.replay.events[0].freqHz)).toBeCloseTo(60, 6)
  })

  it('没有生成器的知识点抛错，消息含定位信息', () => {
    expect(() => generate(spec({ kpId: 'rhythm:quarter', track: 'R' }), c)).toThrow(/rhythm:quarter@recognize/)
  })
})

describe('generate：快照（固定 seed）', () => {
  const cases: [string, Partial<ExerciseSpec>][] = [
    ['普通音级·听辨', { kpId: 'degree:major:re', modality: 'recognize', contextLevel: 1, variationLevel: 2, difficultyStep: 2, seed: 101 }],
    ['普通音级·唱', { kpId: 'degree:major:la', modality: 'sing', contextLevel: 2, variationLevel: 3, difficultyStep: 4, seed: 102 }],
    ['普通音级·听写', { kpId: 'degree:minor:si', modality: 'notate', contextLevel: 3, variationLevel: 6, difficultyStep: 5, seed: 103 }],
    ['转调·听辨', { kpId: 'degree:modulation:shift', modality: 'recognize', contextLevel: 0, variationLevel: 1, seed: 104 }],
    ['转调·唱', { kpId: 'degree:modulation:shift', modality: 'sing', contextLevel: 4, variationLevel: 4, seed: 105 }],
    ['转调·听写', { kpId: 'degree:modulation:shift', modality: 'notate', contextLevel: 2, variationLevel: 5, seed: 106 }],
    ['品质·听辨', { kpId: 'chord:quality-min', track: 'H', modality: 'recognize', contextLevel: 1, variationLevel: 6, difficultyStep: 1, seed: 201 }],
    ['功能和弦·唱', { kpId: 'chord:V7', track: 'H', modality: 'sing', contextLevel: 2, variationLevel: 3, difficultyStep: 5, seed: 202 }],
    ['功能和弦·听写', { kpId: 'chord:VI', track: 'H', modality: 'notate', contextLevel: 3, variationLevel: 4, difficultyStep: 4, seed: 203 }],
    ['进行·听辨', { kpId: 'prog:i-VI-III-VII', track: 'H', modality: 'recognize', contextLevel: 0, variationLevel: 2, difficultyStep: 5, seed: 204 }],
    ['进行·听写', { kpId: 'prog:I-vi-IV-V', track: 'H', modality: 'notate', contextLevel: 2, variationLevel: 5, seed: 205 }],
    ['转位·听辨', { kpId: 'chord:inv-second', track: 'H', modality: 'recognize', contextLevel: 1, variationLevel: 3, difficultyStep: 2, seed: 206 }],
    ['低音线·唱', { kpId: 'chord:bassline', track: 'H', modality: 'sing', contextLevel: 2, variationLevel: 6, difficultyStep: 4, seed: 207 }],
    ['低音线·听写', { kpId: 'chord:bassline', track: 'H', modality: 'notate', contextLevel: 4, variationLevel: 1, seed: 208 }],
  ]
  for (const [name, o] of cases) {
    it(name, () => {
      expect(generate(spec(o), c)).toMatchSnapshot()
    })
  }
})

describe('generate：属性（P-2b spec §11 第 3 条）', () => {
  const specs = randomSpecs(600)

  it('正确答案必判为对', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      expect(grade(ex, answerAsResponse(ex.answer)).correct).toBe(true)
    }
  })

  it('plan、replay、slow 的全部音高落在 MIDI 36–96', () => {
    for (const s of specs) {
      for (const m of allMidis(generate(s, c))) {
        expect(m).toBeGreaterThanOrEqual(PLAN_MIDI_MIN - 1e-6)
        expect(m).toBeLessThanOrEqual(PLAN_MIDI_MAX + 1e-6)
      }
    }
  })

  it('确定性：同一输入两次生成深度相等', () => {
    for (const s of specs.slice(0, 100)) {
      expect(generate(s, c)).toEqual(generate(s, c))
    }
  })

  it('选择题选项 id 不重复且含答案；听写答案都在字母表里', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      if (ex.format.kind === 'choice' && ex.answer.kind === 'choice') {
        const ids = ex.format.options.map((o) => o.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toContain(ex.answer.id)
        expect(ids.length).toBeGreaterThanOrEqual(2)
      }
      if (ex.format.kind === 'sequence' && ex.answer.kind === 'sequence') {
        const alphabet = new Set(ex.format.alphabet.map((o) => o.id))
        expect(ex.answer.ids.every((id) => alphabet.has(id))).toBe(true)
        expect(ex.answer.ids).toHaveLength(ex.format.length)
      }
    }
  })

  it('小调的主音落在音区中心附近（折叠前 ±6 半音）', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      if (ex.resolved.key.mode !== 'minor') continue
      const tonic = freqToMidi(ex.feedback.replay.events[0].freqHz)
      expect(Math.abs(tonic - ex.resolved.centerMidi)).toBeLessThanOrEqual(6 + 1e-6)
    }
  })

  it('答案格式与题目格式同种', () => {
    for (const s of specs) {
      const ex = generate(s, c)
      expect(ex.answer.kind).toBe(ex.format.kind)
    }
  })

  it('H 轨：题目内容不依赖逐音折叠——plan 里的内容事件与生成器给出的音高完全一致（P-2b spec §14）', () => {
    for (const s of specs.filter((x) => x.track === 'H')) {
      // 按管线同样的顺序单独跑一次生成器，拿到「折叠前」的内容
      const entry = lookupGenerator(s.kpId)
      if (!entry) throw new Error(`没有生成器：${s.kpId}`)
      const rng = makeRng(s.seed)
      const resolved = resolveVariation(s.variationLevel, entry.mode, rng)
      const content = entry.byModality[s.modality]({
        spec: s, curriculum: c, resolved, doMidi: doMidiFor(resolved), rng,
      })
      const ex = generate(s, c)
      // 语境事件（终止式、持续低音、主音提示）都在 contentStartSec 之前起音
      const inPlan = ex.plan.events
        .filter((e) => e.atSec >= ex.contentStartSec - 1e-9)
        .map((e) => Math.round(freqToMidi(e.freqHz)))
        .sort((a, b) => a - b)
      const fromGenerator = content.notes.map((n) => n.midi).sort((a, b) => a - b)
      expect(inPlan).toEqual(fromGenerator)
    }
  })

  it('随机规格里确实有 H 轨', () => {
    expect(specs.filter((x) => x.track === 'H').length).toBeGreaterThan(100)
  })
})
