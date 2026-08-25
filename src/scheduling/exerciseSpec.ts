import type { ContextLevel } from '../music/tonalContext'
import {
  parseKpId,
  trackOfKind,
  type KnowledgePointId,
  type Modality,
  type Track,
} from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'

export type SessionSegment = 'warmup' | 'review' | 'focus' | 'introduce' | 'boss'

export const SESSION_SEGMENTS: readonly SessionSegment[] = [
  'warmup',
  'review',
  'focus',
  'introduce',
  'boss',
]

/**
 * 调度器的输出单元。只描述规格，不含任何可播放内容——
 * 渲染由 P-2b 的生成器按 (spec, seed) 产出（建模决策 3）。
 */
export interface ExerciseSpec {
  kpId: KnowledgePointId
  modality: Modality
  track: Track
  /** 慢机制给出的语境强度 */
  contextLevel: ContextLevel
  /** 慢机制给出的变异等级 */
  variationLevel: VariationLevel
  /** 快机制（2-down-1-up）给出的单题难度档，0 最易 */
  difficultyStep: number
  /** 生成器用的确定性整数种子 */
  seed: number
  segment: SessionSegment
}

/** 单题预估耗时（秒），含语境播放、作答与反馈 */
export const ITEM_SECONDS: Record<Modality, number> = {
  recognize: 12,
  sing: 20,
  notate: 25,
}

export function itemSeconds(spec: ExerciseSpec): number {
  return ITEM_SECONDS[spec.modality]
}

export function isWellFormedSpec(spec: ExerciseSpec): boolean {
  if (spec.kpId.length === 0) return false
  if (!Number.isInteger(spec.seed)) return false
  if (!Number.isInteger(spec.difficultyStep) || spec.difficultyStep < 0) return false
  if (spec.contextLevel < 0 || spec.contextLevel > 4) return false
  if (spec.variationLevel < 0 || spec.variationLevel > 6) return false
  if (!SESSION_SEGMENTS.includes(spec.segment)) return false
  if (!(spec.modality in ITEM_SECONDS)) return false
  try {
    if (trackOfKind(parseKpId(spec.kpId).kind) !== spec.track) return false
  } catch {
    return false
  }
  return true
}

/** 供仿真断言失败时输出定位信息 */
export function describeSpec(spec: ExerciseSpec): string {
  return `${spec.kpId}@${spec.modality} L${spec.contextLevel} V${spec.variationLevel} d${spec.difficultyStep} [${spec.segment}]`
}
