import { describe, expect, it } from 'vitest'
import { MIXED_COMBOS, METERS } from '../data/rhythms'
import { DIFFICULTY_TABLE } from '../difficulty'
import { pulsesPerBar } from '../metronome'
import { METER_GENERATORS, MIXED_METER_GENERATORS, NOTATE_METER_PHRASE_PULSES, filledPassage } from './meter'
import { RHYTHM_LEGATO, barStartTimes } from './rhythmCommon'
import { generatorInput } from './testInput'

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

describe('filledPassage', () => {
  it('每个拍号小节都铺满；null 小节为空且固定为 4/4', () => {
    const input = generatorInput('rhythm:meter-3-4', 'notate', { seed: 4 })
    const out = filledPassage(['3/4', '3/4', null, '2/4'], input)
    expect(out.bars).toEqual([METERS['3/4'], METERS['3/4'], METERS['4/4'], METERS['2/4']])
    const starts = barStartTimes(out.bars, input.resolved.bpm)
    const inBar = (b: number) => out.onsets.filter((o) => o.atSec >= starts[b] - 1e-9 && (b + 1 >= starts.length || o.atSec < starts[b + 1] - 1e-9))
    expect(inBar(2)).toHaveLength(0)
    for (const b of [0, 1, 3]) {
      expect(inBar(b)[0].atSec).toBeCloseTo(starts[b], 9)
      expect(inBar(b)[0].accent).toBe(true)
    }
  })
})

describe('拍号·听辨', () => {
  it('固定 12 个感知拍、全部是目标拍号、中性节拍器；选项来自池并含答案', () => {
    for (const [kp, id] of [['rhythm:meter-2-4', '2/4'], ['rhythm:meter-3-4', '3/4'], ['rhythm:meter-6-8', '6/8']] as const) {
      for (const seed of SEEDS) {
        const r = METER_GENERATORS.recognize(generatorInput(kp, 'recognize', { seed, step: 5 }))
        expect(r.answer).toEqual({ kind: 'choice', id })
        const bars = r.rhythm?.bars ?? []
        expect(bars).toHaveLength({ '2/4': 6, '3/4': 4, '6/8': 6 }[id])
        for (const b of bars) expect(b).toEqual(METERS[id])
        expect(r.rhythm?.metronome).toBe('neutral')
        if (r.format.kind !== 'choice') throw new Error('格式错')
        expect(r.format.options.map((o) => o.id)).toContain(id)
        expect(r.prompt).toBe('which-meter')
      }
    }
  })

  it('R1 的 2/4 题：池里只有 2/4 与 3/4', () => {
    const r = METER_GENERATORS.recognize(generatorInput('rhythm:meter-2-4', 'recognize', { step: 5 }))
    if (r.format.kind !== 'choice') throw new Error('格式错')
    expect(r.format.options.map((o) => o.id).sort()).toEqual(['2/4', '3/4'])
  })
})

describe('拍号·打拍', () => {
  it('边听边打强拍：内容在放；答案是各小节起点；小节数按档位', () => {
    for (let step = 0; step <= 5; step++) {
      const input = generatorInput('rhythm:meter-3-4', 'sing', { step, seed: step + 2 })
      const r = METER_GENERATORS.sing(input)
      if (r.format.kind !== 'tap' || r.answer.kind !== 'tap') throw new Error('格式错')
      const bars = r.rhythm?.bars ?? []
      expect(bars).toHaveLength(Math.max(2, DIFFICULTY_TABLE.tapBars[step] + 1))
      expect(r.notes.length).toBeGreaterThan(0)
      expect(r.answer.onsetsSec).toEqual(barStartTimes(bars, input.resolved.bpm))
      expect(r.format.patternIds).toBeUndefined()
      expect(r.prompt).toBe('tap-downbeats')
    }
  })
})

describe('拍号·听写', () => {
  it('段数按档位（至少 2），含目标拍号；每段固定 6 个感知拍，段间空一小节 4/4', () => {
    for (let step = 0; step <= 5; step++) {
      for (const seed of SEEDS.slice(0, 10)) {
        const r = METER_GENERATORS.notate(generatorInput('rhythm:meter-6-8', 'notate', { step, seed }))
        if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
        const phrases = Math.max(2, DIFFICULTY_TABLE.notateRhythmBars[step])
        expect(r.answer.ids).toHaveLength(phrases)
        expect(r.answer.ids).toContain('6/8')
        const bars = r.rhythm?.bars ?? []
        let i = 0
        r.answer.ids.forEach((id, k) => {
          const meter = METERS[id as keyof typeof METERS]
          let pulses = 0
          while (pulses < NOTATE_METER_PHRASE_PULSES) {
            expect(bars[i]).toEqual(meter)
            pulses += pulsesPerBar(bars[i])
            i++
          }
          expect(pulses).toBe(NOTATE_METER_PHRASE_PULSES)
          if (k < phrases - 1) {
            expect(bars[i]).toEqual(METERS['4/4'])
            i++
          }
        })
        expect(i).toBe(bars.length)
        expect(r.format.alphabet.map((o) => o.id).sort()).toEqual(['2/4', '3/4', '6/8'])
        expect(r.prompt).toBe('notate-meters')
      }
    }
  })

  it('每段的小节数：2/4 与 6/8 为 3 小节，3/4 为 2 小节', () => {
    for (const kp of ['rhythm:meter-2-4', 'rhythm:meter-3-4', 'rhythm:meter-6-8']) {
      const r = METER_GENERATORS.notate(generatorInput(kp, 'notate', { step: 0, seed: 3 }))
      if (r.answer.kind !== 'sequence') throw new Error('格式错')
      const first = r.answer.ids[0]
      const bars = r.rhythm?.bars ?? []
      const nFirst = bars.findIndex((b) => b.beatsPerBar === 4 && b.beatUnit === 4)
      expect(nFirst).toBe(first === '3/4' ? 2 : 3)
    }
  })
})

describe('6/8 填充内容', () => {
  it('每个起音时值为 1 或 3 个八分单位；重音只落在小节第一拍', () => {
    for (const seed of SEEDS) {
      const input = generatorInput('rhythm:meter-6-8', 'notate', { seed })
      const p = filledPassage(['6/8', '6/8', '6/8'], input)
      const bpm = input.resolved.bpm
      const eighth = 60 / bpm / 3
      const starts = barStartTimes(p.bars, bpm)
      for (const o of p.onsets) {
        const units = o.durSec / RHYTHM_LEGATO / eighth
        expect([1, 3].some((u) => Math.abs(units - u) < 1e-6)).toBe(true)
        if (o.accent) {
          const local = starts.filter((s) => s <= o.atSec + 1e-9).pop() as number
          expect(o.atSec - local).toBeCloseTo(0, 9)
        }
      }
      expect(p.onsets.some((o) => o.accent)).toBe(true)
    }
  })
})

describe('混合拍子', () => {
  it('听辨：组合循环两遍；答案是组合 id；选项来自组合表', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const r = MIXED_METER_GENERATORS.recognize(generatorInput('rhythm:mixed-meter', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      const answerId = r.answer.id
      const combo = MIXED_COMBOS.find((m) => m.id === answerId)
      if (!combo) throw new Error('答案不是组合')
      seen.add(combo.id)
      expect(r.rhythm?.bars).toEqual([...combo.meters, ...combo.meters].map((m) => METERS[m]))
      for (const o of r.format.options) expect(MIXED_COMBOS.map((m) => m.id)).toContain(o.id)
      expect(r.rhythm?.metronome).toBe('neutral')
      expect(r.prompt).toBe('which-meter-sequence')
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('听辨选项只在同一组拍号的不同顺序之间选：恰好 2 个，同拍号集合', () => {
    for (const seed of SEEDS) {
      const r = MIXED_METER_GENERATORS.recognize(generatorInput('rhythm:mixed-meter', 'recognize', { seed, step: 5 }))
      if (r.answer.kind !== 'choice' || r.format.kind !== 'choice') throw new Error('格式错')
      const sorted = (id: string) => id.split('+').sort()
      expect(r.format.options).toHaveLength(2)
      for (const o of r.format.options) expect(sorted(o.id)).toEqual(sorted(r.answer.id))
    }
  })

  it('打拍：答案是各小节起点', () => {
    const input = generatorInput('rhythm:mixed-meter', 'sing', { seed: 6 })
    const r = MIXED_METER_GENERATORS.sing(input)
    if (r.answer.kind !== 'tap') throw new Error('格式错')
    expect(r.answer.onsetsSec).toEqual(barStartTimes(r.rhythm?.bars ?? [], input.resolved.bpm))
    expect(r.prompt).toBe('tap-downbeats')
  })

  it('听写：逐小节写拍号，字母表 2/4、3/4、4/4', () => {
    const r = MIXED_METER_GENERATORS.notate(generatorInput('rhythm:mixed-meter', 'notate', { seed: 7 }))
    if (r.answer.kind !== 'sequence' || r.format.kind !== 'sequence') throw new Error('格式错')
    expect(r.answer.ids).toHaveLength(4)
    expect(r.format.alphabet.map((o) => o.id)).toEqual(['2/4', '3/4', '4/4'])
    expect(r.prompt).toBe('notate-meters')
  })
})
