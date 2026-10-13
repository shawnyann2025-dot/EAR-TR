import { chordToMidi, type Chord } from '../../music/chord'
import { DEGREE_SEMITONES, SCALE_DEGREES, type Key, type ScaleDegree } from '../../music/key'
import { midiToFreq } from '../../music/pitch'
import type { NoteSpec } from '../../music/playback'
import { degreeToMidi, degreeToMidiFromTonic } from '../../music/register'
import { octaveOffsetToFit } from '../context'
import { BASE_BPM, SING_CENTS_TOLERANCE } from '../difficulty'
import type { PitchTarget } from '../types'
import { SING_NOTE_SEC } from './degree'

/** 进行与听写里每个和弦占几拍 */
export const CHORD_BEATS = 2
/** 琶音呈现时相邻和弦音的起音间隔（秒，以 BASE_BPM 为基准） */
export const ARPEGGIO_STEP_SEC = 0.18
/** 和弦占位里实际发声的比例，留一点空隙让和弦交替清楚 */
export const CHORD_LEGATO = 0.9

/** 和弦类唱题至少唱的目标音数：只唱一个音无法区分品质或功能 */
export const MIN_CHORD_SING_TARGETS = 2

/** 根音落在 [主音, 主音+11]——与 T 轨音级同一锚点（P-2b spec §7.2、§14） */
export function chordRootMidi(chord: Chord, key: Key, doMidi: number): number {
  return degreeToMidiFromTonic(chord.rootDegree, key, doMidi)
}

/** 原位（或 chord.inversion 指定的向上旋转）密集排列，整体挪到以主音为锚的八度 */
export function chordMidis(chord: Chord, key: Key, doMidi: number): number[] {
  const shift = chordRootMidi(chord, key, doMidi) - degreeToMidi(chord.rootDegree, doMidi)
  return chordToMidi(chord, doMidi).map((m) => m + shift)
}

export function degreeAbove(degree: ScaleDegree, semitones: number): ScaleDegree {
  return SCALE_DEGREES[(((DEGREE_SEMITONES[degree] + semitones) % 12) + 12) % 12]
}

export function chordSlotSec(bpm: number): number {
  return (CHORD_BEATS * 60) / bpm
}

/** block：同时起音；arpeggio：依次起音、同时结束（主 spec §6.2 呈现方式轴） */
export function chordNotes(
  midis: readonly number[],
  atSec: number,
  durSec: number,
  gain: number,
  presentation: 'block' | 'arpeggio',
  bpm: number,
): NoteSpec[] {
  if (presentation === 'block') {
    return midis.map((midi) => ({ midi, atSec, durSec, gain }))
  }
  // 短时长时收紧步长，保证每个音都在 durSec 之前起音、并恰在 atSec+durSec 结束
  const step = Math.min(ARPEGGIO_STEP_SEC * (BASE_BPM / bpm), durSec / (midis.length + 1))
  return midis.map((midi, i) => ({
    midi,
    atSec: atSec + i * step,
    durSec: durSec - i * step,
    gain,
  }))
}

export interface FittedItem {
  notes: NoteSpec[]
  feedbackNotes: NoteSpec[]
  targetMidis: number[]
}

/**
 * 整题统一移同一个八度（P-2b spec §14）：内容、反馈、唱的目标三组一起算偏移、
 * 一起平移，组内与组间的音程（含低音与上方声部的关系）完全保留。
 */
export function fitItem(item: FittedItem): FittedItem {
  const k = octaveOffsetToFit([
    ...item.notes.map((n) => n.midi),
    ...item.feedbackNotes.map((n) => n.midi),
    ...item.targetMidis,
  ])
  if (k === 0) return item
  return {
    notes: item.notes.map((n) => ({ ...n, midi: n.midi + k })),
    feedbackNotes: item.feedbackNotes.map((n) => ({ ...n, midi: n.midi + k })),
    targetMidis: item.targetMidis.map((m) => m + k),
  }
}

export function pitchTargets(
  degrees: readonly ScaleDegree[],
  midis: readonly number[],
): PitchTarget[] {
  if (degrees.length !== midis.length) {
    throw new Error(`唱的目标音级数 ${degrees.length} 与音高数 ${midis.length} 不一致`)
  }
  return degrees.map((degree, i) => ({
    degree,
    midi: midis[i],
    freqHz: midiToFreq(midis[i]),
    centsTolerance: SING_CENTS_TOLERANCE,
  }))
}

/** 唱的目标音依次排开（反馈里放给学习者听） */
export function sungSequence(
  midis: readonly number[],
  gain: number,
  startSec = 0,
): NoteSpec[] {
  return midis.map((midi, i) => ({
    midi,
    atSec: startSec + i * SING_NOTE_SEC,
    durSec: SING_NOTE_SEC,
    gain,
  }))
}
