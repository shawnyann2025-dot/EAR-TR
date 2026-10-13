import type { Key, Mode } from '../music/key'
import type { TimbreId } from '../music/playback'
import { doMidiForKey } from '../music/register'
import type { Rng } from '../music/rng'
import type { ResolvedVariation } from './types'

export const TIMBRES: readonly TimbreId[] = ['piano', 'strings', 'voice', 'electronic']
export const DEFAULT_TIMBRE: TimbreId = 'piano'

export const DEFAULT_CENTER_MIDI = 60
/** 音区中心随机范围：中心 ±1 个八度（P-2b spec D6，FWD-4 第一层） */
export const REGISTER_MIN = 48
export const REGISTER_MAX = 72

export const DEFAULT_BPM = 90
export const BPM_MIN = 70
export const BPM_MAX = 110

export const DEFAULT_VELOCITY = 0.8
export const VELOCITY_MIN = 0.6
export const VELOCITY_MAX = 1.0

const PRESENTATIONS = ['block', 'arpeggio'] as const

/** 未开放调轴时的默认调：大调 C，小调 a（la 基唱名下 do 仍是 C） */
export function defaultKey(mode: Mode): Key {
  return mode === 'major' ? { tonic: 0, mode } : { tonic: 9, mode }
}

/**
 * 管线第 1 步：按 variationLevel 决定每条轴取默认值还是从 rng 抽取。
 *
 * 开放顺序固定（主 spec §6.2）：1 调、2 音色、3 音区、4 速度、5 力度、6 呈现方式。
 * rng 消耗：level 0 不消耗 rng；每开放一条轴按轴序消耗固定次数的抽取。
 * 因此再开放一条轴会让其后所有抽取（内容、选项打乱）整体错位，不保持原有序列。
 */
export function resolveVariation(
  variationLevel: number,
  mode: Mode,
  rng: Rng,
): ResolvedVariation {
  const open = (axis: number): boolean => variationLevel >= axis

  const key: Key = open(1) ? { tonic: rng.int(12), mode } : defaultKey(mode)
  const timbreId = open(2) ? rng.pick(TIMBRES) : DEFAULT_TIMBRE
  const centerMidi = open(3)
    ? REGISTER_MIN + rng.int(REGISTER_MAX - REGISTER_MIN + 1)
    : DEFAULT_CENTER_MIDI
  const bpm = open(4) ? BPM_MIN + rng.int(BPM_MAX - BPM_MIN + 1) : DEFAULT_BPM
  const velocity = open(5)
    ? VELOCITY_MIN + rng.next() * (VELOCITY_MAX - VELOCITY_MIN)
    : DEFAULT_VELOCITY
  const presentation = open(6) ? rng.pick(PRESENTATIONS) : 'block'

  return { key, timbreId, centerMidi, bpm, velocity, presentation }
}

/**
 * 'do' 的 MIDI 落位：让主音（而非 do）最接近音区中心。
 * 大调主音就是 do；小调主音 la 在 do 上方 9 半音，所以按 centerMidi - 9 取 do。
 */
export function doMidiFor(resolved: ResolvedVariation): number {
  const { key, centerMidi } = resolved
  return doMidiForKey(key, key.mode === 'minor' ? centerMidi - 9 : centerMidi)
}
