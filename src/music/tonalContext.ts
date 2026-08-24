import { chordToMidi, type Chord } from './chord'
import type { Key } from './key'
import {
  mergePlans,
  notesToPlan,
  type PlaybackPlan,
  type TimbreId,
} from './playback'
import { tonicMidi } from './register'

/** 语境强度。spec §6.1：L0 最强（完整终止式）→ L4 最弱（中途撤走）。 */
export type ContextLevel = 0 | 1 | 2 | 3 | 4

export interface TonalContextParams {
  key: Key
  level: ContextLevel
  timbreId: TimbreId
  /** 'do' 的 MIDI 落位 */
  doMidi: number
  /** 题目内容本身的时长，语境需据此伸缩 */
  itemDurSec: number
}

export interface TonalContextResult {
  plan: PlaybackPlan
  /** 从计划起点到题目内容应当开始的时刻 */
  leadInSec: number
}

const CHORD_DUR_SEC = 0.55
const GAP_SEC = 0.35
const DRONE_LEAD_SEC = 0.5
const TONIC_BLIP_DUR_SEC = 0.7
const TONIC_BLIP_LEAD_SEC = 1.0
/** L4：低音覆盖题目的前 40% 后撤走 */
const L4_COVERAGE = 0.4
const CONTEXT_GAIN = 0.5
const DRONE_GAIN = 0.35

/**
 * 该调的终止式。
 * 大调用 ii–V–I。小调用 iv–V–i，其中 V 强制为大三——自然小调的 v 是小三，
 * 缺少导音就建立不起调中心，这正是终止式存在的意义。
 */
export function cadenceChords(key: Key): Chord[] {
  if (key.mode === 'major') {
    return [
      { rootDegree: 're', quality: 'min', inversion: 0 },
      { rootDegree: 'sol', quality: 'maj', inversion: 0 },
      { rootDegree: 'do', quality: 'maj', inversion: 0 },
    ]
  }
  return [
    { rootDegree: 're', quality: 'min', inversion: 0 },
    { rootDegree: 'mi', quality: 'maj', inversion: 0 },
    { rootDegree: 'la', quality: 'min', inversion: 0 },
  ]
}

export function buildTonalContext(params: TonalContextParams): TonalContextResult {
  const { key, level, timbreId, doMidi, itemDurSec } = params

  switch (level) {
    case 0:
      return buildCadence(cadenceChords(key), doMidi, timbreId)
    case 1:
      return buildCadence(cadenceChords(key).slice(1), doMidi, timbreId)
    case 2:
      return buildDrone(key, doMidi, timbreId, DRONE_LEAD_SEC + itemDurSec)
    case 3:
      return buildBlip(key, doMidi, timbreId)
    case 4:
      return buildDrone(
        key,
        doMidi,
        timbreId,
        DRONE_LEAD_SEC + itemDurSec * L4_COVERAGE,
      )
  }
}

function buildCadence(
  chords: Chord[],
  doMidi: number,
  timbreId: TimbreId,
): TonalContextResult {
  const plans = chords.map((chord, i) => {
    const atSec = i * CHORD_DUR_SEC
    const notes = chordToMidi(chord, doMidi).map((midi) => ({
      midi,
      atSec,
      durSec: CHORD_DUR_SEC,
      gain: CONTEXT_GAIN,
    }))
    return notesToPlan(notes, timbreId)
  })
  return {
    plan: mergePlans(...plans),
    leadInSec: chords.length * CHORD_DUR_SEC + GAP_SEC,
  }
}

function buildDrone(
  key: Key,
  doMidi: number,
  timbreId: TimbreId,
  durSec: number,
): TonalContextResult {
  // 降一个八度，让低音托住而不与题目音高打架
  const midi = tonicMidi(key, doMidi) - 12
  return {
    plan: notesToPlan([{ midi, atSec: 0, durSec, gain: DRONE_GAIN }], timbreId),
    leadInSec: DRONE_LEAD_SEC,
  }
}

function buildBlip(key: Key, doMidi: number, timbreId: TimbreId): TonalContextResult {
  const midi = tonicMidi(key, doMidi) - 12
  return {
    plan: notesToPlan(
      [{ midi, atSec: 0, durSec: TONIC_BLIP_DUR_SEC, gain: DRONE_GAIN }],
      timbreId,
    ),
    leadInSec: TONIC_BLIP_LEAD_SEC,
  }
}
