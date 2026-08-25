import type { TimbreId } from '../music/playback'

export interface Harmonic {
  /** 相对基频的倍数 */
  ratio: number
  gain: number
}

export interface Envelope {
  attackSec: number
  decaySec: number
  /** 衰减后维持的电平，0–1 */
  sustain: number
  releaseSec: number
}

export interface TimbreDef {
  id: TimbreId
  partials: Harmonic[]
  env: Envelope
  oscType: OscillatorType
}

/**
 * 加法合成音色。全部由振荡器叠加而成，无外部音频资源（spec §6.2）。
 * 分音增益之和 ≤ 1，避免叠加削波。
 */
export const TIMBRES: Record<TimbreId, TimbreDef> = {
  // 起音快、无延音、泛音随次数快速衰减
  piano: {
    id: 'piano',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.5 },
      { ratio: 2, gain: 0.22 },
      { ratio: 3, gain: 0.12 },
      { ratio: 4, gain: 0.06 },
    ],
    env: { attackSec: 0.004, decaySec: 1.6, sustain: 0.02, releaseSec: 0.3 },
  },
  // 起音慢、延音高、奇偶泛音都在
  strings: {
    id: 'strings',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.42 },
      { ratio: 2, gain: 0.2 },
      { ratio: 3, gain: 0.16 },
      { ratio: 4, gain: 0.1 },
      { ratio: 5, gain: 0.06 },
    ],
    env: { attackSec: 0.16, decaySec: 0.3, sustain: 0.75, releaseSec: 0.45 },
  },
  // 低次泛音重、高次弱，中等起音
  voice: {
    id: 'voice',
    oscType: 'sine',
    partials: [
      { ratio: 1, gain: 0.55 },
      { ratio: 2, gain: 0.24 },
      { ratio: 3, gain: 0.13 },
      { ratio: 5, gain: 0.05 },
    ],
    env: { attackSec: 0.07, decaySec: 0.2, sustain: 0.6, releaseSec: 0.25 },
  },
  // 方波基底 + 少量高次，听感明显偏电子
  electronic: {
    id: 'electronic',
    oscType: 'square',
    partials: [
      { ratio: 1, gain: 0.34 },
      { ratio: 2, gain: 0.16 },
      { ratio: 6, gain: 0.08 },
    ],
    env: { attackSec: 0.01, decaySec: 0.12, sustain: 0.5, releaseSec: 0.12 },
  },
}

/**
 * 从 TIMBRES 派生，而非手写字面量：TIMBRES 缺键会编译报错，
 * 但手写的 TimbreId[] 数组标注下，子集仍然合法、会静默漏音色。
 * 这是音色变异轴的唯一采样源（rng.pick(TIMBRE_IDS)），必须与 TIMBRES 同步。
 */
export const TIMBRE_IDS = Object.keys(TIMBRES) as readonly TimbreId[]
