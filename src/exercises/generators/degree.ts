import type { Modality } from '../../curriculum/knowledgePoints'
import type { ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidi } from '../../music/register'
import { degreeEntry, requireDegreeEntry } from '../data/degrees'
import { BASE_BPM, SING_CENTS_TOLERANCE, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers, shuffle } from '../pools'
import type { ContentResult, Generator, GeneratorInput, PitchTarget } from '../types'

/** 唱模态每个目标音预留的时长（秒），也是反馈里每个目标音的时值 */
export const SING_NOTE_SEC = 1.0
/** 听写旋律相邻音的最大音程（半音）：纯五度 */
export const MAX_MELODIC_LEAP = 7
/** 听写旋律的音符占一拍的比例，留一点空隙让音头清楚 */
const LEGATO = 0.9

function poolDegrees(input: GeneratorInput): ScaleDegree[] {
  return poolMembers(input.curriculum, input.spec.kpId, (id) => degreeEntry(id)?.pool).map(
    (id) => requireDegreeEntry(id).degree,
  )
}

export const recognizeDegree: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const p = difficultyParams(spec.difficultyStep)
  const durSec = p.recognizeNoteSec * (BASE_BPM / resolved.bpm)
  const notes: NoteSpec[] = [
    { midi: degreeToMidi(entry.degree, doMidi), atSec: 0, durSec, gain: resolved.velocity },
  ]
  const options = pickOptions(entry.degree, poolDegrees(input), p.recognizeOptionCount, rng)
  return {
    notes,
    feedbackNotes: notes,
    durSec,
    prompt: 'which-degree',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.degree },
  }
}

export const singDegrees: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const count = difficultyParams(spec.difficultyStep).singTargetCount
  const others = shuffle(
    poolDegrees(input).filter((d) => d !== entry.degree),
    rng,
  ).slice(0, count - 1)
  const sequence = shuffle([entry.degree, ...others], rng)

  const targets: PitchTarget[] = sequence.map((degree) => {
    const midi = degreeToMidi(degree, doMidi)
    return { degree, midi, freqHz: midiToFreq(midi), centsTolerance: SING_CENTS_TOLERANCE }
  })
  const feedbackNotes: NoteSpec[] = targets.map((t, i) => ({
    midi: t.midi,
    atSec: i * SING_NOTE_SEC,
    durSec: SING_NOTE_SEC,
    gain: resolved.velocity,
  }))
  return {
    notes: [],
    feedbackNotes,
    durSec: targets.length * SING_NOTE_SEC,
    prompt: 'sing-degrees',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

export const notateMelody: Generator = (input): ContentResult => {
  const { spec, resolved, doMidi, rng } = input
  const entry = requireDegreeEntry(spec.kpId)
  const length = difficultyParams(spec.difficultyStep).notateMelodyLength
  const pool = poolDegrees(input)
  const midiOf = (d: ScaleDegree) => degreeToMidi(d, doMidi)
  const near = (from: ScaleDegree) =>
    pool.filter((d) => Math.abs(midiOf(d) - midiOf(from)) <= MAX_MELODIC_LEAP)

  // 先把目标放在随机位置，再向两侧随机游走——保证必含目标且每步音程合规
  const sequence: ScaleDegree[] = new Array(length)
  const targetPos = rng.int(length)
  sequence[targetPos] = entry.degree
  for (let i = targetPos + 1; i < length; i++) sequence[i] = rng.pick(near(sequence[i - 1]))
  for (let i = targetPos - 1; i >= 0; i--) sequence[i] = rng.pick(near(sequence[i + 1]))

  const beat = 60 / resolved.bpm
  const notes: NoteSpec[] = sequence.map((d, i) => ({
    midi: midiOf(d),
    atSec: i * beat,
    durSec: beat * LEGATO,
    gain: resolved.velocity,
  }))
  return {
    notes,
    feedbackNotes: notes,
    durSec: length * beat,
    prompt: 'notate-melody',
    format: { kind: 'sequence', length, alphabet: pool.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...sequence] },
  }
}

export const DEGREE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeDegree,
  sing: singDegrees,
  notate: notateMelody,
}
