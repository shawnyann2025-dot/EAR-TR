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
  return plan.events.map((e) => {
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
