import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { METERS, PICKUP_IDS } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import {
  ANACRUSIS_GENERATORS,
  BEAT_ONE_GENERATORS,
  PICKUP_START_PULSE,
  anacrusisPassage,
  beatOnePassage,
} from './pickup'
import { barStartTimes, patternsUpTo } from './rhythmCommon'
import { generatorInput } from './testInput'

const c = buildCurriculum()
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)

describe('beatOnePassage', () => {
  it('第 0 小节从中间起拍；答案序号正好指向第 1 小节的第一个音；该音加重，此前的音都不加重', () => {
    for (const seed of SEEDS) {
      const input = generatorInput('rhythm:beat-one', 'recognize', { seed })
      const p = beatOnePassage(input, 2)
      const starts = barStartTimes(p.bars, input.resolved.bpm)
      expect(p.bars).toHaveLength(3)
      expect(p.onsets[0].atSec).toBeCloseTo((p.startPulse * 60) / input.resolved.bpm, 9)
      expect(p.onsets[0].atSec).toBeGreaterThan(starts[0] + 1e-9)
      const target = p.onsets[p.answerIndex - 1]
      expect(target.atSec).toBeCloseTo(starts[1], 9)
      expect(target.accent).toBe(true)
      expect(p.onsets.slice(0, p.answerIndex - 1).every((o) => !o.accent)).toBe(true)
      expect(p.candidates).toContain(String(p.answerIndex))
      expect(p.candidates.length).toBeLessThanOrEqual(8)
    }
  })

  it('会出现不同拍号', () => {
    const seen = new Set(SEEDS.map((seed) => JSON.stringify(beatOnePassage(generatorInput('rhythm:beat-one', 'recognize', { seed }), 2).bars[0])))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('找 beat 1·三模态', () => {
  it('听辨：选项是候选序号；中性节拍器', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const r = BEAT_ONE_GENERATORS.recognize(generatorInput('rhythm:beat-one', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      expect(r.format.options.map((o) => o.id)).toContain(r.answer.id)
      expect(r.rhythm?.metronome).toBe('neutral')
      expect(r.prompt).toBe('which-onset-is-beat-one')
    }
  })

  it('打拍：答案是满小节的起点（不含起拍那一小节）', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:beat-one', 'sing', { step, seed: step + 1 })
      const r = BEAT_ONE_GENERATORS.sing(input)
      if (r.answer.kind !== 'tap') throw new Error('格式错')
      const bars = r.rhythm?.bars ?? []
      expect(bars).toHaveLength(1 + Math.max(2, DIFFICULTY_TABLE.tapBars[step] + 1))
      const shift = ((r.rhythm?.startPulse ?? 0) * 60) / input.resolved.bpm
      expect(r.rhythm?.startPulse).toBeGreaterThan(0)
      const expected = barStartTimes(bars, input.resolved.bpm).slice(1).map((t) => t - shift)
      expect(r.answer.onsetsSec).toHaveLength(expected.length)
      r.answer.onsetsSec.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9))
      expect(r.prompt).toBe('tap-downbeats')
    }
  })

  it('听写：长度 1 的序号序列', () => {
    const r = BEAT_ONE_GENERATORS.notate(generatorInput('rhythm:beat-one', 'notate', { seed: 3 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.format.length).toBe(1)
    expect(r.format.alphabet.map((o) => o.id)).toContain(r.answer.ids[0])
  })
})

describe('找 beat 1·startPulse', () => {
  it('三模态都设置 startPulse > 0；听辨与听写的第一个内容音在 0', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const m of ['recognize', 'sing', 'notate'] as const) {
        const r = BEAT_ONE_GENERATORS[m](generatorInput('rhythm:beat-one', m, { seed }))
        expect(r.rhythm?.startPulse).toBeGreaterThan(0)
        if (m !== 'sing') expect(r.notes[0].atSec).toBeCloseTo(0, 9)
      }
    }
  })
})

describe('anacrusisPassage', () => {
  it('第 0 小节只有弱起且不加重；第 1、2 小节是单小节音型、第一拍加重', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const input = generatorInput('rhythm:anacrusis', 'recognize', { seed })
      const p = anacrusisPassage(input)
      seen.add(p.pickupId)
      expect(p.bars).toEqual([METERS['4/4'], METERS['4/4'], METERS['4/4']])
      const starts = barStartTimes(p.bars, input.resolved.bpm)
      const bar0 = p.onsets.filter((o) => o.atSec < starts[1] - 1e-9)
      expect(bar0).toHaveLength({ none: 0, half: 1, one: 1 }[p.pickupId])
      expect(bar0.every((o) => !o.accent)).toBe(true)
      expect(p.patterns).toHaveLength(2)
      for (const pat of p.patterns) expect(pat.bars).toBe(1)
      for (const b of [1, 2]) {
        const first = p.onsets.find((o) => o.atSec >= starts[b] - 1e-9)
        expect(first?.atSec).toBeCloseTo(starts[b], 9)
        expect(first?.accent).toBe(true)
      }
    }
    expect([...seen].sort()).toEqual([...PICKUP_IDS].sort())
  })
})

describe('弱起·三模态', () => {
  it('听辨：答案是弱起 id；中性节拍器', () => {
    const r = ANACRUSIS_GENERATORS.recognize(generatorInput('rhythm:anacrusis', 'recognize', { seed: 2, step: 5 }))
    if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
    expect(PICKUP_IDS).toContain(r.answer.id as (typeof PICKUP_IDS)[number])
    expect(r.format.options.map((o) => o.id).sort()).toEqual([...PICKUP_IDS].sort())
    expect(r.rhythm?.metronome).toBe('neutral')
    expect(r.prompt).toBe('which-pickup')
  })

  it('打拍：不放内容，显示 [弱起, 音型1, 音型2]，按拍号节拍器', () => {
    const r = ANACRUSIS_GENERATORS.sing(generatorInput('rhythm:anacrusis', 'sing', { seed: 5 }))
    if (r.format.kind !== 'tap') throw new Error('格式错')
    expect(r.notes).toEqual([])
    expect(r.format.patternIds).toHaveLength(3)
    expect(PICKUP_IDS).toContain(r.format.patternIds?.[0] as (typeof PICKUP_IDS)[number])
    expect(r.rhythm?.metronome).toBe('metered')
    expect(r.prompt).toBe('tap-pattern')
  })

  it('听写：[弱起, 音型1, 音型2]，字母表 = 弱起 id + 单小节音型池', () => {
    const r = ANACRUSIS_GENERATORS.notate(generatorInput('rhythm:anacrusis', 'notate', { seed: 8 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.answer.ids).toHaveLength(3)
    expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(
      [...PICKUP_IDS, ...patternsUpTo(c, 'rhythm:anacrusis', { singleBarOnly: true }).map((p) => p.id)].sort(),
    )
    expect(r.prompt).toBe('notate-patterns')
  })
})

describe('弱起·startPulse', () => {
  it('听辨与听写的中性节拍器从 PICKUP_START_PULSE 起；打拍保持 metered 且无 startPulse', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const m of ['recognize', 'notate'] as const) {
        const input = generatorInput('rhythm:anacrusis', m, { seed })
        const r = ANACRUSIS_GENERATORS[m](input)
        const pickup = (r.answer.kind === 'choice' ? r.answer.id : r.answer.kind === 'sequence' ? r.answer.ids[0] : '') as keyof typeof PICKUP_START_PULSE
        expect(r.rhythm?.startPulse).toBe(PICKUP_START_PULSE[pickup])
        const expectFirst = pickup === 'half' ? (0.5 * 60) / input.resolved.bpm : 0
        expect(r.notes[0].atSec).toBeCloseTo(expectFirst, 9)
      }
      const t = ANACRUSIS_GENERATORS.sing(generatorInput('rhythm:anacrusis', 'sing', { seed }))
      expect(t.rhythm?.startPulse).toBeUndefined()
      expect(t.rhythm?.metronome).toBe('metered')
    }
  })
})
