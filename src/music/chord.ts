import type { Key, ScaleDegree } from './key'
import { degreeToMidi } from './register'

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug'
  | 'dom7' | 'maj7' | 'min7' | 'halfDim7'

/** 各品质自根音起的半音间隔 */
export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  halfDim7: [0, 3, 6, 10],
}

export interface Chord {
  rootDegree: ScaleDegree
  quality: ChordQuality
  /** 转位数。0 = 原位。超过音数会取模。 */
  inversion: number
}

/** 大调各级的根音音级与品质（相对 do 表达） */
const MAJOR_DIATONIC: Record<number, { rootDegree: ScaleDegree; quality: ChordQuality }> = {
  1: { rootDegree: 'do', quality: 'maj' },
  2: { rootDegree: 're', quality: 'min' },
  3: { rootDegree: 'mi', quality: 'min' },
  4: { rootDegree: 'fa', quality: 'maj' },
  5: { rootDegree: 'sol', quality: 'maj' },
  6: { rootDegree: 'la', quality: 'min' },
  7: { rootDegree: 'ti', quality: 'dim' },
}

/** 自然小调各级（la 基，故根音音级相对 do 表达时从 la 起算） */
const MINOR_DIATONIC: Record<number, { rootDegree: ScaleDegree; quality: ChordQuality }> = {
  1: { rootDegree: 'la', quality: 'min' },
  2: { rootDegree: 'ti', quality: 'dim' },
  3: { rootDegree: 'do', quality: 'maj' },
  4: { rootDegree: 're', quality: 'min' },
  5: { rootDegree: 'mi', quality: 'min' },
  6: { rootDegree: 'fa', quality: 'maj' },
  7: { rootDegree: 'sol', quality: 'maj' },
}

/** 求该调第 step 级（1–7）的自然音和弦 */
export function diatonicChord(key: Key, step: number, inversion = 0): Chord {
  const table = key.mode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC
  const entry = table[step]
  if (!entry) throw new Error(`级数必须在 1–7 之间，收到 ${step}`)
  return { ...entry, inversion }
}

/** 把和弦落到具体 MIDI 音高，返回升序数组 */
export function chordToMidi(chord: Chord, doMidi: number): number[] {
  const root = degreeToMidi(chord.rootDegree, doMidi)
  const intervals = QUALITY_INTERVALS[chord.quality]
  let notes = intervals.map((i) => root + i)
  const rotations = ((chord.inversion % notes.length) + notes.length) % notes.length
  for (let i = 0; i < rotations; i++) {
    notes = [...notes.slice(1), notes[0] + 12]
  }
  return notes
}

export interface Voicing {
  /** 低音声部（单音） */
  bassMidi: number
  /** 上方声部：从根音起的原位密集排列 */
  upperMidis: number[]
}

/**
 * 带独立低音声部的排列（FWD-3）。
 *
 * chordToMidi 把转位做成「向上旋转」，低音会被推高（二转 C 的低音是 G4）——
 * 对 H6 的转位与低音线听辨不够用。这里让低音待在低音区：低音取转位指定的
 * 和弦音、放在根音下方一个八度的区域；上方声部保持原位密集。
 * 低音最高为 rootMidi + 11 - 12 = rootMidi - 1，故严格低于全部上方声部。
 * 不改 chordToMidi——它对 H1–H5 的行为是正确的。
 */
export function voiceChord(chord: Chord, rootMidi: number): Voicing {
  const intervals = QUALITY_INTERVALS[chord.quality]
  const n = intervals.length
  const inv = ((chord.inversion % n) + n) % n
  return {
    bassMidi: rootMidi + intervals[inv] - 12,
    upperMidis: intervals.map((i) => rootMidi + i),
  }
}
