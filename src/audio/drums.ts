import type { DrumId } from '../music/playback'

export interface DrumDef {
  kind: 'tone' | 'noise'
  startHz?: number
  endHz?: number
  dropSec?: number
  filter?: { type: BiquadFilterType; hz: number }
  decaySec: number
  peak: number
}

/** 简易鼓（P-5 spec §3.2）：底鼓是下滑正弦，军鼓与踩镲是滤波噪声 */
export const DRUMS: Record<DrumId, DrumDef> = {
  kick: { kind: 'tone', startHz: 150, endHz: 50, dropSec: 0.08, decaySec: 0.3, peak: 0.9 },
  snare: { kind: 'noise', filter: { type: 'bandpass', hz: 1800 }, decaySec: 0.15, peak: 0.5 },
  hat: { kind: 'noise', filter: { type: 'highpass', hz: 7000 }, decaySec: 0.05, peak: 0.3 },
}
