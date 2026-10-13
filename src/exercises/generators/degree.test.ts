import { describe, expect, it } from 'vitest'
import { DEGREE_SEMITONES, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import { degreeToMidi } from '../../music/register'
import { DIFFICULTY_TABLE } from '../difficulty'
import {
  MAX_MELODIC_LEAP,
  SING_NOTE_SEC,
  notateMelody,
  recognizeDegree,
  singDegrees,
} from './degree'
import { generatorInput } from './testInput'

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)
const T2_POOL = ['do', 'mi', 'sol', 're', 'la']

describe('recognizeDegree', () => {
  it('放单个目标音，音高 = degreeToMidi(目标, doMidi)', () => {
    const input = generatorInput('degree:major:re', 'recognize')
    const r = recognizeDegree(input)
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0].midi).toBe(degreeToMidi('re', input.doMidi))
    expect(r.notes[0].atSec).toBe(0)
    expect(r.feedbackNotes).toEqual(r.notes)
    expect(r.prompt).toBe('which-degree')
    expect(r.answer).toEqual({ kind: 'choice', id: 're' })
  })

  it('选项个数按档位、受池大小限制，且都来自干扰池', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const r = recognizeDegree(generatorInput('degree:major:re', 'recognize', { step, seed }))
        if (r.format.kind !== 'choice') throw new Error('格式错')
        const ids = r.format.options.map((o) => o.id)
        expect(ids).toHaveLength(Math.min(DIFFICULTY_TABLE.recognizeOptionCount[step], T2_POOL.length))
        expect(ids).toContain('re')
        expect(ids.every((id) => T2_POOL.includes(id))).toBe(true)
      }
    }
  })

  it('目标音时长随档位缩短（默认 90 bpm 下即表中秒数）', () => {
    expect(recognizeDegree(generatorInput('degree:major:re', 'recognize', { step: 0 })).durSec).toBeCloseTo(1.0, 12)
    expect(recognizeDegree(generatorInput('degree:major:re', 'recognize', { step: 5 })).durSec).toBeCloseTo(0.5, 12)
  })

  it('gain 等于力度（旋律内容视为重音）', () => {
    const input = generatorInput('degree:major:re', 'recognize')
    expect(recognizeDegree(input).notes[0].gain).toBe(input.resolved.velocity)
  })

  it('小调升 7 级的答案 id 是 le', () => {
    const r = recognizeDegree(generatorInput('degree:minor:si', 'recognize', { mode: 'minor' }))
    expect(r.answer).toEqual({ kind: 'choice', id: 'le' })
  })
})

describe('singDegrees', () => {
  it('目标音个数按档位，必含目标，全部来自池', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const r = singDegrees(generatorInput('degree:major:re', 'sing', { step, seed }))
        if (r.format.kind !== 'pitch') throw new Error('格式错')
        const degrees = r.format.targets.map((t) => t.degree)
        expect(degrees).toHaveLength(DIFFICULTY_TABLE.singTargetCount[step])
        expect(degrees).toContain('re')
        expect(degrees.every((d) => T2_POOL.includes(d))).toBe(true)
      }
    }
  })

  it('目标的 midi、频率与容差', () => {
    const input = generatorInput('degree:major:re', 'sing', { step: 4, seed: 3 })
    const r = singDegrees(input)
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    for (const t of r.format.targets) {
      expect(t.midi).toBe(degreeToMidi(t.degree, input.doMidi))
      expect(t.freqHz).toBeCloseTo(midiToFreq(t.midi), 9)
      expect(t.centsTolerance).toBe(50)
    }
    expect(r.answer).toEqual({ kind: 'pitch', targets: r.format.targets })
  })

  it('题目里不放目标音（要学习者自己唱），反馈里依次放出目标音', () => {
    const r = singDegrees(generatorInput('degree:major:re', 'sing', { step: 4, seed: 3 }))
    if (r.format.kind !== 'pitch') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.feedbackNotes.map((n) => n.midi)).toEqual(r.format.targets.map((t) => t.midi))
    expect(r.feedbackNotes.map((n) => n.atSec)).toEqual(r.format.targets.map((_, i) => i * SING_NOTE_SEC))
    expect(r.durSec).toBeCloseTo(r.format.targets.length * SING_NOTE_SEC, 12)
    expect(r.prompt).toBe('sing-degrees')
  })
})

describe('notateMelody', () => {
  it('长度按档位、至少含一次目标、相邻音程不超过纯五度', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS) {
        const input = generatorInput('degree:major:re', 'notate', { step, seed })
        const r = notateMelody(input)
        if (r.answer.kind !== 'sequence') throw new Error('格式错')
        const ids = r.answer.ids
        expect(ids).toHaveLength(DIFFICULTY_TABLE.notateMelodyLength[step])
        expect(ids).toContain('re')
        for (let i = 1; i < r.notes.length; i++) {
          expect(Math.abs(r.notes[i].midi - r.notes[i - 1].midi)).toBeLessThanOrEqual(MAX_MELODIC_LEAP)
        }
      }
    }
  })

  it('答案与实际播放的音一一对应', () => {
    const input = generatorInput('degree:major:re', 'notate', { step: 3, seed: 5 })
    const r = notateMelody(input)
    if (r.answer.kind !== 'sequence') throw new Error('格式错')
    expect(r.notes.map((n) => n.midi)).toEqual(
      r.answer.ids.map((id) => input.doMidi + DEGREE_SEMITONES[id as ScaleDegree]),
    )
  })

  it('字母表 = 整个干扰池；格式长度 = 答案长度', () => {
    const r = notateMelody(generatorInput('degree:major:re', 'notate', { step: 2 }))
    if (r.format.kind !== 'sequence' || r.answer.kind !== 'sequence') throw new Error('格式错')
    expect(r.format.alphabet.map((o) => o.id).sort()).toEqual([...T2_POOL].sort())
    expect(r.format.length).toBe(r.answer.ids.length)
    expect(r.prompt).toBe('notate-melody')
  })

  it('每个音一拍，等时值', () => {
    const input = generatorInput('degree:major:re', 'notate', { step: 2 })
    const r = notateMelody(input)
    const beat = 60 / input.resolved.bpm
    expect(r.notes.map((n) => n.atSec)).toEqual(r.notes.map((_, i) => i * beat))
    expect(r.durSec).toBeCloseTo(r.notes.length * beat, 12)
  })
})

describe('确定性', () => {
  it('同一输入两次生成结果相同', () => {
    for (const gen of [recognizeDegree, singDegrees, notateMelody]) {
      expect(gen(generatorInput('degree:major:la', 'notate', { step: 4, seed: 11 }))).toEqual(
        gen(generatorInput('degree:major:la', 'notate', { step: 4, seed: 11 })),
      )
    }
  })
})
