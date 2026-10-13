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
import { RHYTHM_ENTRIES } from './data/rhythms'
import { tonicMidi } from '../music/register'
import { barSec } from './generators/rhythmCommon'
import { BEAT_ONE_GENERATORS } from './generators/pickup'
import { generatorInput } from './generators/testInput'
import { CLICK_OCTAVE, answerAsResponse, generate, generateWith, grade, lookupGenerator } from './generate'
import { CLICK_GAIN_ACCENT } from './metronome'
import type { ContentResult, Exercise, GeneratorEntry } from './types'
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

const TH_ROWS: { kpId: string; track: 'T' | 'H' | 'R' }[] = [
  ...DEGREE_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'T' as const })),
  ...CHORD_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'H' as const })),
  ...RHYTHM_ENTRIES.map((e) => ({ kpId: e.kpId, track: 'R' as const })),
]
const pickTH = (rng: { pick<T>(xs: readonly T[]): T }) => rng.pick(TH_ROWS)

/** 覆盖全部 T/H/R 轨知识点 × 模态 × 语境 × 变异 × 档位的随机规格 */
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

  it('每个 H/R 轨知识点都有生成器；T/H 用调性语境，R 用节拍器语境', () => {
    for (const e of CHORD_ENTRIES) expect(lookupGenerator(e.kpId)?.context).toBe('tonal')
    expect(lookupGenerator('chord:i')?.mode).toBe('minor')
    for (const e of RHYTHM_ENTRIES) {
      const g = lookupGenerator(e.kpId)
      expect(g?.context).toBe('metronome')
      expect(g?.mode).toBe('major')
    }
    expect(lookupGenerator('degree:major:do')?.context).toBe('tonal')
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
    expect(() => generate(spec({ kpId: 'rhythm:nope', track: 'R' }), c)).toThrow(/rhythm:nope@recognize/)
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
    ['音型·听辨', { kpId: 'rhythm:synco-8', track: 'R', modality: 'recognize', contextLevel: 1, variationLevel: 4, difficultyStep: 3, seed: 301 }],
    ['音型·打拍', { kpId: 'rhythm:tie-across-bar', track: 'R', modality: 'sing', contextLevel: 2, variationLevel: 5, difficultyStep: 4, seed: 302 }],
    ['音型·听写', { kpId: 'rhythm:triplet', track: 'R', modality: 'notate', contextLevel: 0, variationLevel: 2, difficultyStep: 2, seed: 303 }],
    ['拍号·听辨', { kpId: 'rhythm:meter-6-8', track: 'R', modality: 'recognize', contextLevel: 2, variationLevel: 3, difficultyStep: 5, seed: 304 }],
    ['拍号·听写', { kpId: 'rhythm:meter-3-4', track: 'R', modality: 'notate', contextLevel: 3, variationLevel: 1, difficultyStep: 3, seed: 305 }],
    ['找 beat 1·打拍', { kpId: 'rhythm:beat-one', track: 'R', modality: 'sing', contextLevel: 1, variationLevel: 0, difficultyStep: 4, seed: 306 }],
    ['弱起·听辨', { kpId: 'rhythm:anacrusis', track: 'R', modality: 'recognize', contextLevel: 4, variationLevel: 6, difficultyStep: 5, seed: 307 }],
    ['混合拍子·听写', { kpId: 'rhythm:mixed-meter', track: 'R', modality: 'notate', contextLevel: 2, variationLevel: 6, seed: 308 }],
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

  it('随机规格里确实有 R 轨', () => {
    expect(specs.filter((x) => x.track === 'R').length).toBeGreaterThan(100)
  })

  it('R 轨：打拍题的起音都落在内容时长之内，且严格递增', () => {
    for (const s of specs.filter((x) => x.track === 'R' && x.modality === 'sing')) {
      const ex = generate(s, c)
      if (ex.format.kind !== 'tap') throw new Error(`R 轨唱模态应为打拍：${s.kpId}`)
      const onsets = ex.format.onsetsSec
      expect(onsets.length).toBeGreaterThan(0)
      for (let i = 1; i < onsets.length; i++) expect(onsets[i]).toBeGreaterThan(onsets[i - 1])
    }
  })

  it('R 轨：内容音高都是主音，点击都是主音上方一个八度（折叠前）', () => {
    for (const s of specs.filter((x) => x.track === 'R').slice(0, 150)) {
      const ex = generate(s, c)
      const pcs = new Set(ex.plan.events.map((e) => ((Math.round(freqToMidi(e.freqHz)) % 12) + 12) % 12))
      expect(pcs.size).toBe(1)
    }
  })
})

describe('generateWith：按语境分派', () => {
  const fakeContent = (withRhythm: boolean): ContentResult => ({
    notes: [{ midi: 60, atSec: 0, durSec: 0.2, gain: 0.8 }],
    feedbackNotes: [{ midi: 60, atSec: 0, durSec: 0.2, gain: 0.8 }],
    durSec: 4 * (60 / 90),
    prompt: 'which-pattern',
    format: { kind: 'choice', options: [{ id: 'a' }, { id: 'b' }] },
    answer: { kind: 'choice', id: 'a' },
    ...(withRhythm ? { rhythm: { bars: [{ beatsPerBar: 4, beatUnit: 4 }], metronome: 'metered' as const } } : {}),
  })
  const metronomeEntry = (withRhythm: boolean): GeneratorEntry => ({
    mode: 'major',
    context: 'metronome',
    byModality: { recognize: () => fakeContent(withRhythm), sing: () => fakeContent(withRhythm), notate: () => fakeContent(withRhythm) },
  })
  const rSpec = spec({ kpId: 'rhythm:quarter', track: 'R', contextLevel: 1 })

  it('节拍器语境：一小节预备拍（默认 90 bpm），内容在其后', () => {
    const ex = generateWith(metronomeEntry(true), rSpec, c)
    expect(ex.contentStartSec).toBeCloseTo(4 * (60 / 90), 12)
    expect(ex.plan.events.some((e) => Math.abs(e.atSec - ex.contentStartSec) < 1e-9 && Math.round(freqToMidi(e.freqHz)) === 60)).toBe(true)
  })

  it('节拍器语境：点击在主音上方一个八度；反馈先放一小节强拍加重的节拍器', () => {
    const ex = generateWith(metronomeEntry(true), rSpec, c)
    const clickMidi = 60 + CLICK_OCTAVE
    expect(ex.plan.events.some((e) => Math.round(freqToMidi(e.freqHz)) === clickMidi)).toBe(true)
    const anchor = ex.feedback.replay.events.slice(0, 4)
    expect(anchor.every((e) => Math.round(freqToMidi(e.freqHz)) === clickMidi)).toBe(true)
    expect(anchor[0].gain).toBe(CLICK_GAIN_ACCENT)
  })

  it('节拍器语境缺 rhythm：抛错，消息含定位信息', () => {
    expect(() => generateWith(metronomeEntry(false), rSpec, c)).toThrow(/rhythm:quarter@recognize/)
  })

  it('调性语境：generateWith 与 generate 结果一致', () => {
    const s = spec({ kpId: 'degree:major:re', contextLevel: 2, variationLevel: 4, seed: 9 })
    const entry = lookupGenerator(s.kpId)
    if (!entry) throw new Error('缺生成器')
    expect(generateWith(entry, s, c)).toEqual(generate(s, c))
  })
})

describe('R 轨管线：final review', () => {
  const rec = (overrides: Partial<ExerciseSpec>) => spec({ track: 'R', ...overrides })

  it('反馈 replay：内容落在「一小节节拍器 + startPulse 个感知拍」之后，对准脉冲网格', () => {
    let checked = 0
    for (let seed = 1; seed <= 40; seed++) {
      const s = rec({ kpId: 'rhythm:beat-one', modality: 'recognize', contextLevel: 0, seed })
      const content = BEAT_ONE_GENERATORS.recognize(generatorInput(s.kpId, 'recognize', { seed }))
      const startPulse = content.rhythm?.startPulse ?? 0
      if (startPulse === 0) continue
      checked++
      const ex = generate(s, c)
      const bars = content.rhythm?.bars ?? []
      const bpm = ex.resolved.bpm
      const tonic = tonicMidi(ex.resolved.key, doMidiFor(ex.resolved))
      const first = ex.feedback.replay.events.find((e) => Math.round(freqToMidi(e.freqHz)) === tonic)
      if (!first) throw new Error('replay 里没有内容')
      expect(first.atSec).toBeCloseTo(barSec(bars[0], bpm) + (startPulse * 60) / bpm + content.notes[0].atSec, 9)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('点击固定用钢琴音色（反馈锚点也是），内容保持变异音色', () => {
    let checked = 0
    for (let seed = 1; seed <= 40; seed++) {
      const ex = generate(rec({ kpId: 'rhythm:quarter', modality: 'recognize', variationLevel: 6, contextLevel: 0, seed }), c)
      if (ex.resolved.timbreId === 'piano') continue
      checked++
      const tonic = tonicMidi(ex.resolved.key, doMidiFor(ex.resolved))
      for (const p of [ex.plan, ex.feedback.replay]) {
        const clicks = p.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === tonic + CLICK_OCTAVE)
        const contents = p.events.filter((e) => Math.round(freqToMidi(e.freqHz)) === tonic)
        expect(clicks.length).toBeGreaterThan(0)
        expect(contents.length).toBeGreaterThan(0)
        expect(clicks.every((e) => e.timbreId === 'piano')).toBe(true)
        expect(contents.every((e) => e.timbreId === ex.resolved.timbreId)).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
