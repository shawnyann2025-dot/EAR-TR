import type { NoteSpec } from './playback'

export interface Meter {
  beatsPerBar: number
  /** 以几分音符为一拍。4 = 四分音符，8 = 八分音符（复合拍） */
  beatUnit: 4 | 8
}

export interface RhythmEvent {
  /** 相对节奏型起点的拍位 */
  onsetBeats: number
  durBeats: number
  accent: boolean
}

export interface RhythmPattern {
  meter: Meter
  bars: number
  events: RhythmEvent[]
}

export interface TimedOnset {
  atSec: number
  durSec: number
  accent: boolean
}

/** bpm 定义为「每分钟多少个 meter.beatUnit 拍」 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

/** 把节奏型按给定速度展开成绝对时间事件 */
export function expandRhythm(
  pattern: RhythmPattern,
  bpm: number,
  startSec: number,
): TimedOnset[] {
  return pattern.events.map((e) => ({
    atSec: startSec + beatsToSeconds(e.onsetBeats, bpm),
    durSec: beatsToSeconds(e.durBeats, bpm),
    accent: e.accent,
  }))
}

/**
 * 节奏型的总时长，按小节数与拍号计算——不按最后一个音符的结束时间。
 * 否则以休止收尾的节奏型会被截短，覆盖其上的语境 drone 也会提前结束。
 */
export function rhythmDurationSec(pattern: RhythmPattern, bpm: number): number {
  return beatsToSeconds(pattern.bars * pattern.meter.beatsPerBar, bpm)
}

/** 非重音相对重音的力度系数（P-2b spec D9） */
export const ACCENT_OFF_FACTOR = 0.75

/**
 * TimedOnset → NoteSpec 的桥接（FWD-2）。
 *
 * 合成规则：gain = velocity × (accent ? 1 : ACCENT_OFF_FACTOR)。
 * 力度变异轴只决定 velocity，accent 只决定相对系数——两者不再争同一个字段。
 */
export function onsetsToNotes(
  onsets: readonly TimedOnset[],
  midi: number,
  velocity: number,
): NoteSpec[] {
  return onsets.map((o) => ({
    midi,
    atSec: o.atSec,
    durSec: o.durSec,
    gain: velocity * (o.accent ? 1 : ACCENT_OFF_FACTOR),
  }))
}
