import { freqToMidi } from '../music/pitch'
import type { VocalRange } from './range'
import type { Segment } from './segments'

export const MIN_RANGE_SEMITONES = 7

/** 音域测定：取最长的稳定段作为「唱住的那个音」 */
export function pickHeldNote(segments: readonly Segment[]): number | null {
  if (segments.length === 0) return null
  const longest = segments.reduce((a, b) => (b.endSec - b.startSec > a.endSec - a.startSec ? b : a))
  return Math.round(freqToMidi(longest.medianHz))
}

export type RangeCheck = { ok: true; range: VocalRange } | { ok: false; reason: string }

export function validateRange(lowMidi: number | null, highMidi: number | null): RangeCheck {
  if (lowMidi === null || highMidi === null) return { ok: false, reason: '没听到声音，请再唱一次' }
  const lo = Math.min(lowMidi, highMidi)
  const hi = Math.max(lowMidi, highMidi)
  if (hi - lo < MIN_RANGE_SEMITONES) return { ok: false, reason: '音域太窄，请再试一次：最低音尽量低、最高音尽量高' }
  return { ok: true, range: { lowMidi: lo, highMidi: hi } }
}
