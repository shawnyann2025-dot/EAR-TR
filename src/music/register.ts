import { freqToMidi } from './pitch'
import type { PlaybackPlan } from './playback'
import {
  DEGREE_SEMITONES,
  doReference,
  tonicDegree,
  type Key,
  type ScaleDegree,
} from './key'

/**
 * 为某调选定 'do' 的具体 MIDI 落位：取离 centerMidi 最近的那个八度。
 * 这样换调时音区不会漂移，音区变异由 centerMidi 单独控制。
 */
export function doMidiForKey(key: Key, centerMidi: number): number {
  const pc = doReference(key)
  return Math.round((centerMidi - pc) / 12) * 12 + pc
}

/** 给定 'do' 的 MIDI 落位，求某音级的 MIDI */
export function degreeToMidi(degree: ScaleDegree, doMidi: number): number {
  return doMidi + DEGREE_SEMITONES[degree]
}

/** 给定 'do' 的 MIDI 落位，求该调主音的 MIDI */
export function tonicMidi(key: Key, doMidi: number): number {
  return degreeToMidi(tonicDegree(key), doMidi)
}

const FOLD_EPSILON = 1e-9

/**
 * 整份 plan 的八度折叠（FWD-4）：越界事件按八度挪回 [loMidi, hiMidi]。
 *
 * 只动频率，不动时刻、时值、音色与 gain。挪八度保留音级身份，
 * 对练耳题的语义无损；比直接丢弃或钳成同一音高安全。
 */
export function foldPlanToRange(
  plan: PlaybackPlan,
  loMidi: number,
  hiMidi: number,
): PlaybackPlan {
  if (hiMidi - loMidi < 12) {
    throw new Error(`折叠区间必须至少一个八度，收到 ${loMidi}–${hiMidi}`)
  }
  const events = plan.events.map((e) => {
    let freqHz = e.freqHz
    let midi = freqToMidi(freqHz)
    while (midi < loMidi - FOLD_EPSILON) {
      freqHz *= 2
      midi += 12
    }
    while (midi > hiMidi + FOLD_EPSILON) {
      freqHz /= 2
      midi -= 12
    }
    return freqHz === e.freqHz ? e : { ...e, freqHz }
  })
  return { events, totalDurSec: plan.totalDurSec }
}
