import type { Modality } from '../../curriculum/knowledgePoints'
import { QUALITY_INTERVALS, type Chord } from '../../music/chord'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../../music/key'
import type { NoteSpec } from '../../music/playback'
import {
  QUALITY_IDS,
  TONIC_CHORD_ID,
  chordPoolOf,
  functionalChord,
  requireChordEntry,
  type FunctionalEntry,
  type QualityEntry,
} from '../data/chords'
import { BASE_BPM, difficultyParams } from '../difficulty'
import { pickOptions, poolMembers } from '../pools'
import type { ContentResult, Generator, GeneratorInput } from '../types'
import {
  CHORD_LEGATO,
  chordMidis,
  chordNotes,
  chordSlotSec,
  degreeAbove,
  fitItem,
  MIN_CHORD_SING_TARGETS,
  pitchTargets,
  sungSequence,
} from './chordCommon'
import { SING_NOTE_SEC } from './degree'

function qualityEntry(input: GeneratorInput): QualityEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'quality') throw new Error(`${input.spec.kpId} 不是品质知识点`)
  return e
}

function functionalEntry(input: GeneratorInput): FunctionalEntry {
  const e = requireChordEntry(input.spec.kpId)
  if (e.family !== 'functional') throw new Error(`${input.spec.kpId} 不是功能和弦知识点`)
  return e
}

function poolIds(input: GeneratorInput): string[] {
  return poolMembers(input.curriculum, input.spec.kpId, chordPoolOf).map(
    (id) => requireChordEntry(id).answerId,
  )
}

function recognizeDurSec(input: GeneratorInput): number {
  return difficultyParams(input.spec.difficultyStep).recognizeNoteSec * (BASE_BPM / input.resolved.bpm)
}

/** 琶音前 N 个音：音级与音高（原位、以主音为锚） */
function arpeggioHead(chord: Chord, input: GeneratorInput, count: number) {
  const midis = chordMidis(chord, input.resolved.key, input.doMidi).slice(0, count)
  const degrees: ScaleDegree[] = QUALITY_INTERVALS[chord.quality]
    .slice(0, count)
    .map((i) => degreeAbove(chord.rootDegree, i))
  return { midis, degrees }
}

/** 一串和弦，每个占两拍 */
function chordSequenceNotes(chords: readonly Chord[], input: GeneratorInput): NoteSpec[] {
  const { resolved, doMidi } = input
  const slot = chordSlotSec(resolved.bpm)
  return chords.flatMap((ch, i) =>
    chordNotes(chordMidis(ch, resolved.key, doMidi), i * slot, slot * CHORD_LEGATO, resolved.velocity, 'block', resolved.bpm),
  )
}

const recognizeQuality: Generator = (input): ContentResult => {
  const { resolved, doMidi, rng } = input
  const entry = qualityEntry(input)
  const root = rng.pick(MAJOR_SCALE_DEGREES)
  const durSec = recognizeDurSec(input)
  const chord: Chord = { rootDegree: root, quality: entry.quality, inversion: 0 }
  const raw = chordNotes(chordMidis(chord, resolved.key, doMidi), 0, durSec, resolved.velocity, resolved.presentation, resolved.bpm)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, QUALITY_IDS, difficultyParams(input.spec.difficultyStep).recognizeOptionCount, rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-quality',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singQualityArpeggio: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = qualityEntry(input)
  const count = Math.max(MIN_CHORD_SING_TARGETS, difficultyParams(input.spec.difficultyStep).singTargetCount)
  const root = rng.pick(MAJOR_SCALE_DEGREES)
  const head = arpeggioHead({ rootDegree: root, quality: entry.quality, inversion: 0 }, input, count)
  const reference: NoteSpec[] = [{ midi: head.midis[0], atSec: 0, durSec: SING_NOTE_SEC, gain: resolved.velocity }]
  const fit = fitItem({
    notes: reference,
    feedbackNotes: sungSequence(head.midis, resolved.velocity),
    targetMidis: head.midis,
  })
  const targets = pitchTargets(head.degrees, fit.targetMidis)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: SING_NOTE_SEC * (1 + count),
    prompt: 'sing-arpeggio',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateQualities: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = qualityEntry(input)
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const targetPos = rng.int(length)
  const qualities = Array.from({ length }, (_, i) => (i === targetPos ? entry.quality : rng.pick(QUALITY_IDS)))
  const chords: Chord[] = qualities.map((quality) => ({ rootDegree: rng.pick(MAJOR_SCALE_DEGREES), quality, inversion: 0 }))
  const raw = chordSequenceNotes(chords, input)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * chordSlotSec(resolved.bpm),
    prompt: 'notate-qualities',
    format: { kind: 'sequence', length, alphabet: QUALITY_IDS.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids: [...qualities] },
  }
}

const recognizeFunctional: Generator = (input): ContentResult => {
  const { resolved, doMidi, rng } = input
  const entry = functionalEntry(input)
  const durSec = recognizeDurSec(input)
  const raw = chordNotes(chordMidis(entry.chord, resolved.key, doMidi), 0, durSec, resolved.velocity, resolved.presentation, resolved.bpm)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  const options = pickOptions(entry.answerId, poolIds(input), difficultyParams(input.spec.difficultyStep).recognizeOptionCount, rng)
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec,
    prompt: 'which-chord',
    format: { kind: 'choice', options: options.map((id) => ({ id })) },
    answer: { kind: 'choice', id: entry.answerId },
  }
}

const singFunctionalArpeggio: Generator = (input): ContentResult => {
  const entry = functionalEntry(input)
  const count = Math.max(MIN_CHORD_SING_TARGETS, difficultyParams(input.spec.difficultyStep).singTargetCount)
  const head = arpeggioHead(entry.chord, input, count)
  const fit = fitItem({
    notes: [],
    feedbackNotes: sungSequence(head.midis, input.resolved.velocity),
    targetMidis: head.midis,
  })
  const targets = pitchTargets(head.degrees, fit.targetMidis)
  return {
    notes: [],
    feedbackNotes: fit.feedbackNotes,
    durSec: SING_NOTE_SEC * count,
    prompt: 'sing-arpeggio',
    format: { kind: 'pitch', targets },
    answer: { kind: 'pitch', targets },
  }
}

const notateFunctional: Generator = (input): ContentResult => {
  const { resolved, rng } = input
  const entry = functionalEntry(input)
  const length = difficultyParams(input.spec.difficultyStep).notateChordCount
  const pool = poolIds(input)
  if (length < 2) throw new Error(`${input.spec.kpId}：听写长度 ${length} 不足 2`)
  if (pool.length < 3) throw new Error(`${input.spec.kpId}：和弦池只有 ${pool.length} 个成员，至少需要 3 个`)
  const tonicId = TONIC_CHORD_ID[entry.mode]
  // 目标若是主和弦，首位已含目标；否则放在第 2 位及以后
  const targetPos = entry.answerId === tonicId ? 0 : 1 + rng.int(length - 1)
  const ids: string[] = [tonicId]
  for (let i = 1; i < length; i++) {
    // 目标槽之前的一格不能抽到目标，否则目标会与它相邻重复
    const avoidTarget = i + 1 === targetPos ? entry.answerId : undefined
    ids.push(i === targetPos ? entry.answerId : rng.pick(pool.filter((id) => id !== ids[i - 1] && id !== avoidTarget)))
  }
  const raw = chordSequenceNotes(ids.map((id) => functionalChord(entry.mode, id)), input)
  const fit = fitItem({ notes: raw, feedbackNotes: raw, targetMidis: [] })
  return {
    notes: fit.notes,
    feedbackNotes: fit.feedbackNotes,
    durSec: length * chordSlotSec(resolved.bpm),
    prompt: 'notate-chords',
    format: { kind: 'sequence', length, alphabet: pool.map((id) => ({ id })) },
    answer: { kind: 'sequence', ids },
  }
}

export const QUALITY_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeQuality,
  sing: singQualityArpeggio,
  notate: notateQualities,
}

export const FUNCTIONAL_GENERATORS: Record<Modality, Generator> = {
  recognize: recognizeFunctional,
  sing: singFunctionalArpeggio,
  notate: notateFunctional,
}
