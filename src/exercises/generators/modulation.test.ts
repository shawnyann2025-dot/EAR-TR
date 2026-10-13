import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../../music/pitch'
import { tonicMidi } from '../../music/register'
import {
  FIRST_HALF_SEMITONES,
  MAJOR_CADENCE_SEMITONES,
  MINOR_CADENCE_SEMITONES,
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

  it('四小节 16 个四分音符：前 8 个按原调模板，后 8 个按新调模板，以新主音结尾', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const input = generatorInput(KP, 'recognize', { seed })
      const ph = modulationPhrase(input)
      expect(ph.notes).toHaveLength(16)
      const oldTonic = tonicMidi(input.resolved.key, input.doMidi)
      expect(ph.notes.slice(0, 8).map((n) => n.midi - oldTonic)).toEqual([...FIRST_HALF_SEMITONES])
      const template = ph.newKey.mode === 'minor' ? MINOR_CADENCE_SEMITONES : MAJOR_CADENCE_SEMITONES
      expect(ph.notes.slice(8).map((n) => n.midi - ph.newTonicMidi)).toEqual([...template])
      expect(ph.notes[15].midi).toBe(ph.newTonicMidi)
      const beat = 60 / input.resolved.bpm
      expect(ph.notes.map((n) => n.atSec)).toEqual(ph.notes.map((_, i) => i * beat))
      expect(ph.durSec).toBeCloseTo(16 * beat, 12)
    }
  })

  it('模板的最后两音是导音→主音（新调必须靠导音立住）', () => {
    for (const t of [FIRST_HALF_SEMITONES, MAJOR_CADENCE_SEMITONES, MINOR_CADENCE_SEMITONES]) {
      expect(t.slice(-2)).toEqual([-1, 0])
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
