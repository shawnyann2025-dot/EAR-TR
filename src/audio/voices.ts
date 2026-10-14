import type { PlaybackPlan } from '../music/playback'
import { TIMBRES, type TimbreDef } from './timbres'

export interface Voice {
  startSec: number
  /** 振荡器停止时刻，已含释音尾巴 */
  stopSec: number
  freqHz: number
  gain: number
  timbre: TimbreDef
}

/**
 * 把计划翻译成待创建的声部。纯函数——不触碰任何 Web Audio API，
 * 因此播放调度逻辑可以在 Node 下完整单测。
 */
export function planToVoices(plan: PlaybackPlan, startSec: number): Voice[] {
  return plan.events.filter((e) => e.drum === undefined).map((e) => {
    const timbre = TIMBRES[e.timbreId]
    return {
      startSec: startSec + e.atSec,
      stopSec: startSec + e.atSec + e.durSec + timbre.env.releaseSec,
      freqHz: e.freqHz,
      gain: e.gain,
      timbre,
    }
  })
}

/** 整个计划实际发完声的时刻（含释音） */
export function planEndSec(plan: PlaybackPlan, startSec: number): number {
  return planToVoices(plan, startSec).reduce(
    (max, v) => Math.max(max, v.stopSec),
    startSec,
  )
}

/** 截尾后至少保留的释音（秒），避免爆音 */
export const MIN_TAIL_SEC = 0.02

/**
 * FWD-5：在 cutAbsSec 之前本该结束的声部（语境），把释音尾巴截到 cutAbsSec，
 * 免得溢入题目内容。跨过 cutAbsSec 仍在发声的声部（L2/L4 的持续低音）与题目内容不动。
 * 纯函数，不修改输入。
 */
export function trimContextTails(voices: readonly Voice[], cutAbsSec: number): Voice[] {
  return voices.map((v) => {
    const eventEnd = v.stopSec - v.timbre.env.releaseSec
    if (eventEnd > cutAbsSec + 1e-9 || v.stopSec <= cutAbsSec) return v
    return { ...v, stopSec: Math.min(v.stopSec, Math.max(cutAbsSec, eventEnd + MIN_TAIL_SEC)) }
  })
}
