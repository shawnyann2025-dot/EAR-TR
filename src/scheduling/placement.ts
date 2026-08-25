import {
  phaseAt,
  phaseIndex,
  phaseOfKnowledgePoint,
  type Curriculum,
} from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import { stageOrderIndex } from '../curriculum/validate'
import { ALL_STAGES, type PhaseId } from '../curriculum/stages'

/** 约 5 分钟能做完的题量（spec §7.7） */
export const PLACEMENT_MAX_PROBES = 12
export const PLACEMENT_STOP_AFTER_FAILURES = 2

export interface PlacementState {
  probes: KnowledgePointId[]
  results: boolean[]
}

/**
 * 由易到难的探针序列：按级的全课程顺序，每级取第一个引入的知识点。
 * 级数多于探针上限时按等间隔抽取，保证首尾都在。
 */
export function placementProbeOrder(c: Curriculum): KnowledgePointId[] {
  const ordered = [...ALL_STAGES]
    .filter((s) => s.introduces.length > 0)
    .sort((a, b) => stageOrderIndex(c, a.id) - stageOrderIndex(c, b.id))

  if (ordered.length <= PLACEMENT_MAX_PROBES) {
    return ordered.map((s) => s.introduces[0])
  }

  const picked: KnowledgePointId[] = []
  for (let i = 0; i < PLACEMENT_MAX_PROBES; i++) {
    const idx = Math.round((i * (ordered.length - 1)) / (PLACEMENT_MAX_PROBES - 1))
    picked.push(ordered[idx].introduces[0])
  }
  return [...new Set(picked)]
}

export function initialPlacement(c: Curriculum): PlacementState {
  return { probes: placementProbeOrder(c), results: [] }
}

function trailingFailures(results: boolean[]): number {
  let n = 0
  for (let i = results.length - 1; i >= 0 && !results[i]; i--) n++
  return n
}

export function nextProbe(state: PlacementState): KnowledgePointId | null {
  if (state.results.length >= state.probes.length) return null
  if (trailingFailures(state.results) >= PLACEMENT_STOP_AFTER_FAILURES) return null
  return state.probes[state.results.length]
}

export function recordProbe(state: PlacementState, correct: boolean): PlacementState {
  return { ...state, results: [...state.results, correct] }
}

/**
 * 起点 = 最后一个答对的探针所属阶段；一题未对则从 P1 起。
 * 只前进不后退——宁可让学习者多复习，也不要把他推到听不懂的地方。
 */
export function placementResult(c: Curriculum, state: PlacementState): PhaseId {
  let best = 0
  for (let i = 0; i < state.results.length; i++) {
    if (!state.results[i]) continue
    const probe = state.probes[i]
    if (probe === undefined) continue
    best = Math.max(best, phaseIndex(phaseOfKnowledgePoint(c, probe)))
  }
  return phaseAt(best)
}
