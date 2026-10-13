import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../../music/pitch'
import { tonicMidi } from '../../music/register'
import {
  FIRST_HALF_TEMPLATES,
  MAJOR_CADENCE_TEMPLATES,
  MINOR_CADENCE_TEMPLATES,
  MODULATION_GENERATORS,
  SHIFTS,
  SHIFT_ANSWER,
  modulationPhrase,
  newKeyOf,
} from './modulation'
import { generatorInput } from './testInput'

const KP = 'degree:modulation:shift'
const SEEDS = Array.from({ length: 80 }, (_, i) => i + 1)

describe('newKeyOf', () => {
  const C = { tonic: 0, mode: 'major' as const }
  it('四种去向', () => {
    expect(newKeyOf(C, 'stay')).toEqual(C)
    expect(newKeyOf(C, 'IV')).toEqual({ tonic: 5, mode: 'major' })
    expect(newKeyOf(C, 'V')).toEqual({ tonic: 7, mode: 'major' })
    expect(newKeyOf(C, 'relative')).toEqual({ tonic: 9, mode: 'minor' })
  })
  it('音类按 12 取模', () => {
    expect(newKeyOf({ tonic: 10, mode: 'major' }, 'V')).toEqual({ tonic: 5, mode: 'major' })
  })
})

describe('modulationPhrase', () => {
  it('四种去向都会出现', () => {
    const seen = new Set(SEEDS.map((s) => modulationPhrase(generatorInput(KP, 'recognize', { seed: s })).shift))
    expect([...seen].sort()).toEqual([...SHIFTS].sort())
  })

  it('四小节 16 个四分音符：前 8 个取自原调模板之一，后 8 个取自新调模板之一，以新主音结尾', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const input = generatorInput(KP, 'recognize', { seed })
      const ph = modulationPhrase(input)
      expect(ph.notes).toHaveLength(16)
      const oldTonic = tonicMidi(input.resolved.key, input.doMidi)
      expect(FIRST_HALF_TEMPLATES.map((t) => [...t])).toContainEqual(
        ph.notes.slice(0, 8).map((n) => n.midi - oldTonic),
      )
      const templates = ph.newKey.mode === 'minor' ? MINOR_CADENCE_TEMPLATES : MAJOR_CADENCE_TEMPLATES
      expect(templates.map((t) => [...t])).toContainEqual(
        ph.notes.slice(8).map((n) => n.midi - ph.newTonicMidi),
      )
      expect(ph.notes[15].midi).toBe(ph.newTonicMidi)
      const beat = 60 / input.resolved.bpm
      expect(ph.notes.map((n) => n.atSec)).toEqual(ph.notes.map((_, i) => i * beat))
      expect(ph.durSec).toBeCloseTo(16 * beat, 12)
    }
  })

  it('模板的最后两音是导音→主音（新调必须靠导音立住）', () => {
    for (const set of [FIRST_HALF_TEMPLATES, MAJOR_CADENCE_TEMPLATES, MINOR_CADENCE_TEMPLATES]) {
      expect(set.length).toBeGreaterThanOrEqual(3)
      for (const t of set) {
        expect(t).toHaveLength(8)
        expect(t.slice(-2)).toEqual([-1, 0])
        for (let i = 1; i < t.length; i++) expect(Math.abs(t[i] - t[i - 1])).toBeLessThanOrEqual(7)
      }
    }
  })
})

describe('转调不能靠接缝音程判断（终审 item 2）', () => {
  const many = Array.from({ length: 400 }, (_, i) => i + 1)
  const phrases = many.map((seed) => {
    const input = generatorInput(KP, 'recognize', { seed })
    return { input, ph: modulationPhrase(input) }
  })
  const mod12 = (n: number) => ((n % 12) + 12) % 12

  it('stay 的接缝音程集合与转调的相交，且 stay 最常见的接缝音程也出现在某个转调里', () => {
    const seam = (p: (typeof phrases)[number]) => p.ph.notes[8].midi - p.ph.notes[7].midi
    const stay = phrases.filter((p) => p.ph.shift === 'stay').map(seam)
    const shifted = new Set(phrases.filter((p) => p.ph.shift !== 'stay').map(seam))
    expect(stay.some((v) => shifted.has(v))).toBe(true)
    const freq = new Map<number, number>()
    for (const v of stay) freq.set(v, (freq.get(v) ?? 0) + 1)
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
    expect(shifted.has(top)).toBe(true)
  })

  it('新主音与原主音的音类差符合去向', () => {
    const expected = { stay: 0, IV: 5, V: 7, relative: 9 }
    for (const { input, ph } of phrases) {
      const oldTonic = tonicMidi(input.resolved.key, input.doMidi)
      expect(mod12(ph.newTonicMidi - oldTonic)).toBe(expected[ph.shift])
    }
  })

  it('新主音取离原主音最近的八度', () => {
    for (const { input, ph } of phrases) {
      const oldTonic = tonicMidi(input.resolved.key, input.doMidi)
      expect(Math.abs(ph.newTonicMidi - oldTonic)).toBeLessThanOrEqual(6)
    }
  })

  it('十六个音相邻音程 ≤ 7 半音（接缝除外），接缝 ≤ 9', () => {
    for (const { ph } of phrases) {
      for (let i = 1; i < 16; i++) {
        const step = Math.abs(ph.notes[i].midi - ph.notes[i - 1].midi)
        if (i === 8) expect(step).toBeLessThanOrEqual(9)
        else expect(step).toBeLessThanOrEqual(7)
      }
    }
  })
})

describe('三模态', () => {
  it('听辨：选项恰为 shift / stay，答案与实际去向一致', () => {
    for (const seed of SEEDS) {
      const input = generatorInput(KP, 'recognize', { seed })
      const shift = modulationPhrase(generatorInput(KP, 'recognize', { seed })).shift
      const r = MODULATION_GENERATORS.recognize(input)
      if (r.format.kind !== 'choice') throw new Error('格式错')
      expect(r.format.options.map((o) => o.id).sort()).toEqual(['shift', 'stay'])
      expect(r.answer).toEqual({ kind: 'choice', id: shift === 'stay' ? 'stay' : 'shift' })
      expect(r.prompt).toBe('did-it-modulate')
    }
  })

  it('唱：唯一目标是新主音；关系小调唱 la，其余唱 do', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const ph = modulationPhrase(generatorInput(KP, 'sing', { seed }))
      const r = MODULATION_GENERATORS.sing(generatorInput(KP, 'sing', { seed }))
      if (r.format.kind !== 'pitch') throw new Error('格式错')
      expect(r.format.targets).toHaveLength(1)
      const t = r.format.targets[0]
      expect(t.midi).toBe(ph.newTonicMidi)
      expect(t.freqHz).toBeCloseTo(midiToFreq(ph.newTonicMidi), 9)
      expect(t.degree).toBe(ph.shift === 'relative' ? 'la' : 'do')
      expect(t.centsTolerance).toBe(50)
      expect(r.notes).toHaveLength(16)
      expect(r.feedbackNotes.at(-1)?.midi).toBe(ph.newTonicMidi)
      expect(r.prompt).toBe('sing-new-tonic')
    }
  })

  it('听写：长度 1，字母表 do/fa/sol/la，答案按 SHIFT_ANSWER', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const ph = modulationPhrase(generatorInput(KP, 'notate', { seed }))
      const r = MODULATION_GENERATORS.notate(generatorInput(KP, 'notate', { seed }))
      if (r.format.kind !== 'sequence') throw new Error('格式错')
      expect(r.format.length).toBe(1)
      expect(r.format.alphabet.map((o) => o.id)).toEqual(['do', 'fa', 'sol', 'la'])
      expect(r.answer).toEqual({ kind: 'sequence', ids: [SHIFT_ANSWER[ph.shift]] })
      expect(r.prompt).toBe('new-tonic-degree')
    }
  })
})
