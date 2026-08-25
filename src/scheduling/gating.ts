import type { ContextLevel } from '../music/tonalContext'
import type { LevelRequirement } from '../curriculum/curriculum'
import type { VariationLevel } from '../curriculum/stages'
import type { AttemptOutcome, MasteryState } from './mastery'

/** 升到变异等级 i+1 所需的 stability（天） */
export const VARIATION_STABILITY_THRESHOLDS: readonly number[] = [2, 4, 7, 11, 16, 24]

/** 升到语境等级 i+1 所需的 stability（天）。比变异更严——语境是更硬的阶梯。 */
export const CONTEXT_STABILITY_THRESHOLDS: readonly number[] = [3, 6, 10, 15]

/**
 * 升级所需的窗口平均阶梯档位（档位范围 0–5）。
 *
 * 这里**不**用原始正确率作判据（建模决策 4）：2-down-1-up 按设计把观测
 * 正确率锁在约 71%（spec §2.9），任何高于它的正确率门槛都永不可达，
 * 升级将永不发生。平均档位才是「学习者在当前等级下能吃住多难的变体」
 * 的正确度量。
 */
export const PROMOTE_MEAN_STEP = 2
export const MIN_WINDOW_FOR_PROMOTION = 8
export const DEMOTE_TRAILING_ERRORS = 3

/** 供诊断与护栏使用。不再是升级判据。 */
export function windowAccuracy(window: AttemptOutcome[]): number {
  if (window.length === 0) return 0
  return window.filter((a) => a.correct).length / window.length
}

/** 窗口内的平均阶梯档位——升级判据 */
export function meanLadderStep(window: AttemptOutcome[]): number {
  if (window.length === 0) return 0
  return window.reduce((sum, a) => sum + a.difficultyStep, 0) / window.length
}

/** 窗口末尾连续错误的个数 */
export function trailingErrors(window: AttemptOutcome[]): number {
  let n = 0
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].correct) break
    n++
  }
  return n
}

/**
 * 慢机制：跨天移动变异等级与语境等级（spec §7.3，按建模决策 4 修正判据）。
 *
 * 升级需 stability 过阈值 **且** 窗口平均阶梯档位过阈值且窗口足够长，
 * 一次最多升一级，且不得越过当前阶段的要求上限 `cap`——
 * P1 的学习者不该被推到 L4。
 *
 * 回退在尾部连续错误达阈值时触发，且优先于升级判定。缺少回退，
 * 用户会永久卡在挫败区。两级都不为 0 时优先回退语境：
 * 它是更硬的那条阶梯，先松开它收益最大。
 */
export function applyGating(state: MasteryState, cap: LevelRequirement): MasteryState {
  if (trailingErrors(state.window) >= DEMOTE_TRAILING_ERRORS) {
    if (state.contextLevel > 0) {
      return { ...state, contextLevel: (state.contextLevel - 1) as ContextLevel }
    }
    if (state.variationLevel > 0) {
      return { ...state, variationLevel: (state.variationLevel - 1) as VariationLevel }
    }
    return { ...state }
  }

  const eligible =
    state.window.length >= MIN_WINDOW_FOR_PROMOTION &&
    meanLadderStep(state.window) >= PROMOTE_MEAN_STEP

  if (!eligible) return { ...state }

  // 先尝试变异轴：它更便宜，且是抗特异性的主力（spec §2.8）
  const varThreshold = VARIATION_STABILITY_THRESHOLDS[state.variationLevel]
  if (
    varThreshold !== undefined &&
    state.variationLevel < cap.variationLevel &&
    state.stability >= varThreshold
  ) {
    return { ...state, variationLevel: (state.variationLevel + 1) as VariationLevel }
  }

  const ctxThreshold = CONTEXT_STABILITY_THRESHOLDS[state.contextLevel]
  if (
    ctxThreshold !== undefined &&
    state.contextLevel < cap.contextLevel &&
    state.stability >= ctxThreshold
  ) {
    return { ...state, contextLevel: (state.contextLevel + 1) as ContextLevel }
  }

  return { ...state }
}
