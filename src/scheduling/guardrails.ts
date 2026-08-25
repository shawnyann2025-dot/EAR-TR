import type { ContextLevel } from '../music/tonalContext'
import type { VariationLevel } from '../curriculum/stages'
import type { ExerciseSpec } from './exerciseSpec'
import { windowAccuracy } from './gating'
import type { MasteryState } from './mastery'

/** 会话内正确率跌破此值触发回血（spec §7.5） */
export const SESSION_ACCURACY_FLOOR = 0.55
/** 样本不足时不触发，避免开局连错两题就降难度 */
export const MIN_ITEMS_BEFORE_RELIEF = 10

/** 连续多少天无进展触发拆解（spec §7.5） */
export const STAGNATION_DAYS = 3
export const STAGNATION_MIN_ATTEMPTS = 6
export const STAGNATION_ACCURACY = 0.4

export interface SessionProgress {
  attempted: number
  correct: number
}

/** 零尝试时返回 1，避免开局即判定为需要回血 */
export function sessionAccuracy(progress: SessionProgress): number {
  if (progress.attempted === 0) return 1
  return progress.correct / progress.attempted
}

export function needsRelief(progress: SessionProgress): boolean {
  if (progress.attempted < MIN_ITEMS_BEFORE_RELIEF) return false
  return sessionAccuracy(progress) < SESSION_ACCURACY_FLOOR
}

/**
 * 会话内回血：把一道题降到更容易的形态。
 * 语境等级**减小**即语境增强（spec §6.1：L0 最强）。
 */
export function relieveSpec(spec: ExerciseSpec): ExerciseSpec {
  return {
    ...spec,
    difficultyStep: Math.max(0, spec.difficultyStep - 1),
    variationLevel: Math.max(0, spec.variationLevel - 1) as VariationLevel,
    contextLevel: Math.max(0, spec.contextLevel - 1) as ContextLevel,
  }
}

/** 最近 STAGNATION_DAYS 天内练得够多但正确率仍很低 */
export function isStagnant(state: MasteryState, today: number): boolean {
  if (state.lastSeenDay === null) return false
  const since = today - STAGNATION_DAYS
  const recent = state.window.filter((a) => a.day > since)
  if (recent.length < STAGNATION_MIN_ATTEMPTS) return false
  return windowAccuracy(recent) < STAGNATION_ACCURACY
}

/**
 * 拆解：把知识点降到更简单的形态重新爬（spec §7.5）。
 *
 * 清空窗口是必需的——不清空的话，窗口里那串失败会在下一次 applyGating
 * 立刻再次触发回退，把已经拆解过的知识点一路推到底。
 */
export function decompose(state: MasteryState): MasteryState {
  return {
    ...state,
    contextLevel: Math.max(0, state.contextLevel - 1) as ContextLevel,
    variationLevel: Math.max(0, state.variationLevel - 1) as VariationLevel,
    window: [],
  }
}
