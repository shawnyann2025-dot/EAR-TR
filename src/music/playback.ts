import { midiToFreq } from './pitch'

/**
 * 音色标识。定义在 music/ 是因为 PlaybackPlan 需要引用它，
 * 而 music/ 不得依赖 audio/。具体合成参数由 audio/timbres.ts 提供。
 */
export type TimbreId = 'piano' | 'strings' | 'voice' | 'electronic'

/** 鼓（P-5）：不进音色变异轴；有 drum 的事件忽略 freqHz 与 timbreId */
export type DrumId = 'kick' | 'snare' | 'hat'

export interface PlaybackEvent {
  atSec: number
  freqHz: number
  durSec: number
  timbreId: TimbreId
  gain: number
  /** 鼓事件（P-5）；有它时 freqHz 与 timbreId 无意义 */
  drum?: DrumId
}

/**
 * music/ 与 audio/ 之间唯一的数据契约。
 * 声明式：描述「什么时刻、什么频率、什么音色、多长、多响」，不含任何播放机制。
 */
export interface PlaybackPlan {
  events: PlaybackEvent[]
  totalDurSec: number
}

export interface NoteSpec {
  midi: number
  atSec: number
  durSec: number
  gain?: number
}

export function emptyPlan(): PlaybackPlan {
  return { events: [], totalDurSec: 0 }
}

export function notesToPlan(notes: NoteSpec[], timbreId: TimbreId): PlaybackPlan {
  const events: PlaybackEvent[] = notes.map((n) => ({
    atSec: n.atSec,
    freqHz: midiToFreq(n.midi),
    durSec: n.durSec,
    timbreId,
    gain: n.gain ?? 1,
  }))
  return { events, totalDurSec: endOf(events) }
}

/** 合并多个计划。返回新对象，不修改任何输入。 */
export function mergePlans(...plans: PlaybackPlan[]): PlaybackPlan {
  const events = plans
    .flatMap((p) => p.events)
    .slice()
    .sort((a, b) => a.atSec - b.atSec)
  return { events, totalDurSec: endOf(events) }
}

function endOf(events: readonly PlaybackEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.atSec + e.durSec), 0)
}

/** 播放选项（音频层解释，music 层只声明） */
export interface PlayOptions {
  /** 相对计划起点的秒数：此前本该结束的声部，释音尾巴截到这里（FWD-5） */
  cutContextAtSec?: number
}
