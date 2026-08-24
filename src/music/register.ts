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
