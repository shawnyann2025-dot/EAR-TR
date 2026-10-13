import type { Modality } from '../../curriculum/knowledgePoints'
import { tonicDegree, type Key, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { tonicMidi } from '../../music/register'
import { SING_CENTS_TOLERANCE } from '../difficulty'
import { pickOptions } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'

export type Shift = 'stay' | 'IV' | 'V' | 'relative'
export const SHIFTS: readonly Shift[] = ['stay', 'IV', 'V', 'relative']

/** 新主音是原调的哪个音级（听写答案）。关系小调的主音是原调 la */
export const SHIFT_ANSWER: Record<Shift, ScaleDegree> = {
  stay: 'do',
  IV: 'fa',
  V: 'sol',
  relative: 'la',
}

/**
 * 前两小节模板（大调，相对原主音的半音数，ti 在主音下方）。都以导音→主音收束。
 * 抽签而非固定，让「是否转调」不能靠固定的接缝音程判断。
 */
export const FIRST_HALF_TEMPLATES: readonly (readonly number[])[] = [
  [4, 2, 0, 2, 4, 5, -1, 0], // mi re do re mi fa ti do
  [0, 2, 4, 5, 4, 2, -1, 0], // do re mi fa mi re ti do
  [7, 5, 4, 2, 4, 2, -1, 0], // sol fa mi re mi re ti do
]
/**
 * 后两小节模板（大调，相对新主音）：起始音级为 mi / re / do / 下方 la，
 * 使 stay 与各转调的接缝音程互相重叠。
 */
export const MAJOR_CADENCE_TEMPLATES: readonly (readonly number[])[] = [
  [4, 5, 7, 5, 4, 2, -1, 0], // mi fa sol fa mi re ti do
  [2, 4, 5, 7, 5, 2, -1, 0], // re mi fa sol fa re ti do
  [0, 4, 7, 5, 4, 2, -1, 0], // do mi sol fa mi re ti do
  [-3, -1, 0, 2, 4, 2, -1, 0], // la ti do re mi re ti do
]
/** 后两小节模板（小调，相对 la）：起始 mi / do / la / ti，用升 7 级导音（-1）立住小调 */
export const MINOR_CADENCE_TEMPLATES: readonly (readonly number[])[] = [
  [7, 5, 3, 2, 0, 2, -1, 0],
  [3, 5, 7, 5, 3, 2, -1, 0],
  [0, 2, 3, 5, 3, 2, -1, 0],
  [2, 3, 5, 7, 5, 2, -1, 0],
]

/** 新主音相对原主音的音类差（半音，0–11） */
const SHIFT_PITCH_CLASS: Record<Shift, number> = { stay: 0, IV: 5, V: 7, relative: 9 }

export function newKeyOf(key: Key, shift: Shift): Key {
  switch (shift) {
    case 'stay':
      return key
    case 'IV':
      return { tonic: (key.tonic + 5) % 12, mode: 'major' }
    case 'V':
      return { tonic: (key.tonic + 7) % 12, mode: 'major' }
    case 'relative':
      return { tonic: (key.tonic + 9) % 12, mode: 'minor' }
  }
}

export interface ModulationPhrase {
  shift: Shift
  newKey: Key
  newTonicMidi: number
  notes: NoteSpec[]
  durSec: number
}

/**
 * 四小节短句：前两小节原调，后两小节原调或新调（P-2b spec §7.2）。
 * rng 消耗顺序：去向 → 前半模板 → 后半模板。
 */
export function modulationPhrase(input: GeneratorInput): ModulationPhrase {
  const { resolved, doMidi, rng } = input
  const shift = rng.pick(SHIFTS)
  const newKey = newKeyOf(resolved.key, shift)
  const oldTonic = tonicMidi(resolved.key, doMidi)
  // 新主音取离原主音最近的八度（音类差 > 6 则下移一个八度）
  const pcDelta = SHIFT_PITCH_CLASS[shift]
  const newTonicMidi = oldTonic + (pcDelta > 6 ? pcDelta - 12 : pcDelta)
  const first = rng.pick(FIRST_HALF_TEMPLATES)
  const cadence = rng.pick(newKey.mode === 'minor' ? MINOR_CADENCE_TEMPLATES : MAJOR_CADENCE_TEMPLATES)

  const midis = [
    ...first.map((s) => oldTonic + s),
    ...cadence.map((s) => newTonicMidi + s),
  ]
  const beat = 60 / resolved.bpm
  const notes: NoteSpec[] = midis.map((midi, i) => ({
    midi,
    atSec: i * beat,
    durSec: beat * 0.9,
    gain: resolved.velocity,
  }))
  return { shift, newKey, newTonicMidi, notes, durSec: midis.length * beat }
}

const recognizeModulation: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  const answerId = ph.shift === 'stay' ? 'stay' : 'shift'
  const options = pickOptions(answerId, ['shift', 'stay'], 2, input.rng)
  return {
    notes: ph.notes,
    feedbackNotes: ph.notes,
    durSec: ph.durSec,
    prompt: 'did-it-modulate',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: answerId },
  }
}

const singNewTonic: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  const target = {
    degree: tonicDegree(ph.newKey),
    midi: ph.newTonicMidi,
    freqHz: midiToFreq(ph.newTonicMidi),
    centsTolerance: SING_CENTS_TOLERANCE,
  }
  const beat = 60 / input.resolved.bpm
  return {
    notes: ph.notes,
    // 反馈：短句之后再单独放一次新主音
    feedbackNotes: [
      ...ph.notes,
      { midi: ph.newTonicMidi, atSec: ph.durSec + beat, durSec: 1, gain: input.resolved.velocity },
    ],
    durSec: ph.durSec,
    prompt: 'sing-new-tonic',
    format: { kind: 'pitch', targets: [target] },
    answer: { kind: 'pitch', targets: [target] },
  }
}

const notateNewTonic: Generator = (input): ContentResult => {
  const ph = modulationPhrase(input)
  return {
    notes: ph.notes,
    feedbackNotes: ph.notes,
    durSec: ph.durSec,
    prompt: 'new-tonic-degree',
    format: {
      kind: 'sequence',
      length: 1,
      alphabet: (['do', 'fa', 'sol', 'la'] as const).map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [SHIFT_ANSWER[ph.shift]] },
  }
}

export const MODULATION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeModulation,
  sing: singNewTonic,
  notate: notateNewTonic,
}
