import type { Curriculum } from '../../curriculum/curriculum'
import type { KnowledgePointId, Modality } from '../../curriculum/knowledgePoints'
import { stageOrderIndex } from '../../curriculum/validate'
import type { Mode } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import {
  CHORD_ENTRIES,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type ProgressionEntry,
} from '../data/chords'
import { difficultyParams } from '../difficulty'
import { pickOptions, poolMembers, stageOfKnowledgePoint } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordNotes,
  chordRootMidi,
  chordSlotSec,
  fitItem,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

export function rotationIds(chordIds: readonly string[]): string[] {
  return chordIds
    .map((_, r) => [...chordIds.slice(r), ...chordIds.slice(0, r)].join('-'))
    .slice(1)
}

/** 进行类干扰池不足时，用目标和弦的轮转补足（P-2b spec D8） */
export function progressionCandidates(
  target: ProgressionEntry,
  poolIds: readonly string[],
  wanted: number,
): string[] {
  if (poolIds.length >= wanted) return [...poolIds]
  return [...new Set([...poolIds, ...rotationIds(target.chordIds)])]
}

/** 同调式、所在级不晚于该知识点所在级的功能和弦——进行听写的字母表 */
export function functionalAlphabet(
  c: Curriculum,
  mode: Mode,
  kpId: KnowledgePointId,
): string[] {
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(kpId).id)
  return CHORD_ENTRIES.filter(
    (e) =>
      e.family === 'functional' &&
      e.mode === mode &&
      stageOrderIndex(c, stageOfKnowledgePoint(e.kpId).id) <= limit,
  ).map((e) => e.answerId)
}

function progressionEntry(input: GeneratorInput): ProgressionEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'progression') throw new Error(`${input.spec.kpId} 不是进行知识点`)
  return e
}

function progressionNotes(entry: ProgressionEntry, input: GeneratorInput): { notes: NoteSpec[]; durSec: number } {
  const { resolved, doMidi } = input
  const slot = chordSlotSec(resolved.bpm)
  const notes = entry.chordIds.flatMap((id, i) =>
    chordNotes(
      chordMidis(functionalChord(entry.mode, id), resolved.key, doMidi),
      i * slot,
      slot * CHORD_LEGATO,
      resolved.velocity,
      'block',
      resolved.bpm,
    ),
  )
  return { notes, durSec: entry.chordIds.length * slot }
}

const recognizeProgression: Generator = (input): ContentResult => {
  const entry = progressionEntry(input)
  const { notes, durSec } = progressionNotes(entry, input)
  const fit = fitItem({ notes, feedbackNotes: notes, targetMidis: [] })
  const wanted = difficultyParams(input.spec.difficultyStep).recognizeOptionCount
  const pool = poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId,
  )
  const options = pickOptions(entry.answerId, progressionCandidates(entry, pool, wanted), wanted, input.rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-progression',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singProgressionRoots: Generator = (input): ContentResult => {
  const { resolved, doMidi } = input
  const entry = progressionEntry(input)
  const count = Math.min(
    difficultyParams(input.spec.difficultyStep).singTargetCount,
    entry.chordIds.length,
  )
  const { notes, durSec } = progressionNotes(entry, input)
  const chords = entry.chordIds.slice(0, count).map((id) => functionalChord(entry.mode, id))
  const rootMidis = chords.map((ch) => chordRootMidi(ch, resolved.key, doMidi))
  const fit = fitItem({
    notes,
    feedbackNotes: [...notes, ...sungSequence(rootMidis, resolved.velocity, durSec)],
    targetMidis: rootMidis,
  })
  const targets = pitchTargets(chords.map((ch) => ch.rootDegree), fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: durSec + count * SING_NOTE_SEC,
    prompt: 'sing-bassline',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateProgression: Generator = (input): ContentResult => {
  const entry = progressionEntry(input)
  const { notes, durSec } = progressionNotes(entry, input)
  const fit = fitItem({ notes, feedbackNotes: notes, targetMidis: [] })
  const alphabet = functionalAlphabet(input.curriculum, entry.mode, input.spec.kpId)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'notate-progression',
    format: { kind: 'sequence', length: entry.chordIds.length, alphabet: alphabet.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...entry.chordIds] },
  }
}

export const PROGRESSION_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeProgression,
  sing: singProgressionRoots,
  notate: notateProgression,
}
