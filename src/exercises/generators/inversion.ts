import type { Modality } from '../../curriculum/knowledgePoints'
import { QUALITY_INTERVALS, voiceChord, type Chord } from '../../music/chord'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidiFromTonic } from '../../music/register'
import {
  BASSLINE_PATTERNS,
  INVERSION_CHORD_IDS,
  INVERSION_OF,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type BasslinePattern,
  type InversionEntry,
} from '../data/chords'
import { BASE_BPM, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordRootMidi,
  chordSlotSec,
  degreeAbove,
  fitItem,
  MIN_CHORD_SING_TARGETS,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

type InversionId = keyof typeof INVERSION_OF

export function voicedChordMidis(chord: Chord, input: GeneratorInput): { bassMidi: number; upperMidis: number[] } {
  return voiceChord(chord, chordRootMidi(chord, input.resolved.key, input.doMidi))
}

function bassDegreeOf(chord: Chord): ScaleDegree {
  const intervals = QUALITY_INTERVALS[chord.quality]
  const inv = ((chord.inversion % intervals.length) + intervals.length) % intervals.length
  return degreeAbove(chord.rootDegree, intervals[inv])
}

function voicedNotes(chord: Chord, input: GeneratorInput, atSec: number, durSec: number): NoteSpec[] {
  const v = voicedChordMidis(chord, input)
  const gain = input.resolved.velocity
  return [v.bassMidi, ...v.upperMidis].map((midi) => ({ midi, atSec, durSec, gain }))
}

function inversionEntry(input: GeneratorInput): InversionEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'inversion') throw new Error(`${input.spec.kpId} 不是转位知识点`)
  return e
}

/** 候选转位：原位 + 干扰池里不晚于目标所在级的转位 */
function inversionCandidates(input: GeneratorInput): InversionId[] {
  const pool = poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId as InversionId,
  )
  return ['root', ...pool]
}

function randomInversionChord(input: GeneratorInput, inversionId: InversionId): Chord {
  const base = functionalChord('major', input.rng.pick(INVERSION_CHORD_IDS))
  return { ...base, inversion: INVERSION_OF[inversionId] }
}

const recognizeInversion: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const p = difficultyParams(input.spec.difficultyStep)
  const durSec = p.recognizeNoteSec * (BASE_BPM / input.resolved.bpm)
  const chord = randomInversionChord(input, entry.answerId as InversionId)
  const raw = voicedNotes(chord, input, 0, durSec)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, inversionCandidates(input), p.recognizeOptionCount, input.rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-inversion',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singInversionBass: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const slot = chordSlotSec(input.resolved.bpm)
  const chord = randomInversionChord(input, entry.answerId as InversionId)
  const notes = voicedNotes(chord, input, 0, slot * CHORD_LEGATO)
  const bass = voicedChordMidis(chord, input).bassMidi
  const fit = fitItem({
    notes,
    feedbackNotes: [...notes, ...sungSequence([bass], input.resolved.velocity, slot)],
    targetMidis: [bass],
  })
  const targets = pitchTargets([bassDegreeOf(chord)], fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: slot + SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateInversions: Generator = (input): ContentResult => {
  const entry = inversionEntry(input)
  const { rng } = input
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const candidates = inversionCandidates(input)
  const targetPos = rng.int(length)
  const ids: InversionId[] = Array.from({ length }, (_, i) =>
    i === targetPos ? (entry.answerId as InversionId) : rng.pick(candidates),
  )
  const slot = chordSlotSec(input.resolved.bpm)
  const raw = ids.flatMap((id, i) => voicedNotes(randomInversionChord(input, id), input, i * slot, slot * CHORD_LEGATO))
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * slot,
    prompt: 'notate-inversions',
    format: { kind: 'sequence', length, alphabet: candidates.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...ids] },
  }
}

export interface BasslineRender {
  notes: NoteSpec[]
  bassMidis: number[]
  bassDegrees: ScaleDegree[]
  durSec: number
}

/**
 * 低音线：上方声部是各和弦以主音为锚的原位，低音逐步取离上一个低音最近的八度，
 * 让低音走向（上行 / 下行）保持连贯——逐和弦独立放低音会把走向打断。
 */
export function renderBassline(pattern: BasslinePattern, input: GeneratorInput): BasslineRender {
  const { resolved, doMidi } = input
  if (resolved.key.mode !== 'major') throw new Error(`低音线模板仅支持大调，当前为 ${resolved.key.mode}`)
  const slot = chordSlotSec(resolved.bpm)
  const bassMidis: number[] = []
  const bassDegrees: ScaleDegree[] = []
  const notes: NoteSpec[] = []
  pattern.steps.forEach((step, i) => {
    const base = functionalChord('major', step.chordId)
    const chord: Chord = { ...base, inversion: step.inversion }
    const degree = bassDegreeOf(chord)
    let bass = degreeToMidiFromTonic(degree, resolved.key, doMidi) - 12
    if (i > 0) {
      const prev = bassMidis[i - 1]
      while (bass - prev > 6) bass -= 12
      while (prev - bass > 6) bass += 12
    }
    bassMidis.push(bass)
    bassDegrees.push(degree)
    const upper = chordMidis(base, resolved.key, doMidi)
    for (const midi of [bass, ...upper]) {
      notes.push({ midi, atSec: i * slot, durSec: slot * CHORD_LEGATO, gain: resolved.velocity })
    }
  })
  return { notes, bassMidis, bassDegrees, durSec: pattern.steps.length * slot }
}

const recognizeBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const fit = fitItem({ notes: out.notes, feedbackNotes: out.notes, targetMidis: [] })
  const options = pickOptions(
    pattern.id,
    BASSLINE_PATTERNS.map((p) => p.id),
    difficultyParams(input.spec.difficultyStep).recognizeOptionCount,
    input.rng,
  )
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec,
    prompt: 'which-bass-contour',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: pattern.id },
  }
}

const singBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const count = Math.min(
    Math.max(MIN_CHORD_SING_TARGETS, difficultyParams(input.spec.difficultyStep).singTargetCount),
    out.bassMidis.length,
  )
  const sung = out.bassMidis.slice(0, count)
  const fit = fitItem({
    notes: out.notes,
    feedbackNotes: [...out.notes, ...sungSequence(sung, input.resolved.velocity, out.durSec)],
    targetMidis: sung,
  })
  const targets = pitchTargets(out.bassDegrees.slice(0, count), fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec + count * SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateBassline: Generator = (input): ContentResult => {
  const pattern = input.rng.pick(BASSLINE_PATTERNS)
  const out = renderBassline(pattern, input)
  const fit = fitItem({ notes: out.notes, feedbackNotes: out.notes, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: out.durSec,
    prompt: 'notate-bassline',
    format: {
      kind: 'sequence',
      length: out.bassDegrees.length,
      alphabet: MAJOR_SCALE_DEGREES.map((id) => ({ id })),
    },
    answer: { kind: 'sequence', ids: [...out.bassDegrees] },
  }
}

export const INVERSION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeInversion,
  sing: singInversionBass,
  notate: notateInversions,
}

export const BASSLINE_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeBassline,
  sing: singBassline,
  notate: notateBassline,
}
