import type { PitchTarget } from '../exercises/types'

/** hz 相对 targetHz 的音分差 */
export function centsBetween(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz)
}

/** 八度折叠（主 spec §9.3、P-2b §14）：结果在 [-600, 600) */
export function foldCents(c: number): number {
  return ((((c + 600) % 1200) + 1200) % 1200) - 600
}

export interface SungJudgement {
  correct: boolean
  perTarget: boolean[]
  centsOff: (number | null)[]
}

/**
 * 逐音判定（P-4 spec D2）：第 i 个目标对应第 i 个稳定段；缺的记错，多唱的忽略；
 * 每个都在容差内（八度折叠后）才算对，全对才 correct。
 */
export function judgeSung(targets: readonly PitchTarget[], sungHz: readonly number[]): SungJudgement {
  // 非有限或非正的频率（坏输入）按「没唱到」处理
  const usable = (hz: number | undefined): hz is number => hz !== undefined && Number.isFinite(hz) && hz > 0
  const centsOff = targets.map((t, i) => (usable(sungHz[i]) ? foldCents(centsBetween(sungHz[i], t.freqHz)) : null))
  const perTarget = centsOff.map((c, i) => c !== null && Math.abs(c) <= targets[i].centsTolerance)
  return { correct: targets.length > 0 && perTarget.every(Boolean), perTarget, centsOff }
}
