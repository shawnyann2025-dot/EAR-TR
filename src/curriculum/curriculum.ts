import type { ContextLevel } from '../music/tonalContext'
import type { KnowledgePoint, KnowledgePointId } from './knowledgePoints'
import {
  ALL_PHASES,
  ALL_STAGES,
  PHASE_ORDER,
  type Phase,
  type PhaseId,
  type Stage,
  type StageId,
  type VariationLevel,
} from './stages'
import { ALL_KNOWLEDGE_POINTS } from './tracks'

export interface Curriculum {
  knowledgePoints: ReadonlyMap<KnowledgePointId, KnowledgePoint>
  stages: ReadonlyMap<StageId, Stage>
  phases: readonly Phase[]
  phaseOfStage: ReadonlyMap<StageId, PhaseId>
}

export interface LevelRequirement {
  contextLevel: ContextLevel
  variationLevel: VariationLevel
}

export function buildCurriculum(): Curriculum {
  const knowledgePoints = new Map(ALL_KNOWLEDGE_POINTS.map((kp) => [kp.id, kp]))
  const stages = new Map(ALL_STAGES.map((s) => [s.id, s]))
  const phaseOfStage = new Map<StageId, PhaseId>()
  for (const phase of ALL_PHASES) {
    for (const stageId of phase.stages) phaseOfStage.set(stageId, phase.id)
  }
  return { knowledgePoints, stages, phases: ALL_PHASES, phaseOfStage }
}

export function phaseIndex(phaseId: PhaseId): number {
  const i = PHASE_ORDER.indexOf(phaseId)
  if (i < 0) throw new Error(`未知阶段 ${phaseId}`)
  return i
}

export function phaseAt(index: number): PhaseId {
  const id = PHASE_ORDER[index]
  if (!id) throw new Error(`阶段下标越界: ${index}`)
  return id
}

/** 截至该阶段（含）已解锁的全部级 */
export function stagesUpTo(c: Curriculum, phaseId: PhaseId): Stage[] {
  const limit = phaseIndex(phaseId)
  return ALL_STAGES.filter((s) => {
    const p = c.phaseOfStage.get(s.id)
    return p !== undefined && phaseIndex(p) <= limit
  })
}

/** 截至该阶段（含）已引入的全部知识点 */
export function unlockedKnowledgePoints(
  c: Curriculum,
  phaseId: PhaseId,
): KnowledgePointId[] {
  return stagesUpTo(c, phaseId).flatMap((s) => s.introduces)
}

/** 仅该阶段新引入的知识点 */
export function knowledgePointsOfPhase(
  c: Curriculum,
  phaseId: PhaseId,
): KnowledgePointId[] {
  const phase = c.phases.find((p) => p.id === phaseId)
  if (!phase) throw new Error(`未知阶段 ${phaseId}`)
  return phase.stages.flatMap((id) => c.stages.get(id)?.introduces ?? [])
}

/**
 * 某知识点在某阶段的语境/变异要求。
 *
 * 取该知识点所在轨道上、截至当前阶段已解锁的**最高一级**的要求——
 * 不是引入它那一级的要求。这是建模决策 1 的落地：T4 不引入新音级，
 * 但把 T1–T3 引入的全部音级的语境要求一起提到 L3。
 * 同轨道内要求单调不减（由 stages.test.ts 保证），故取最后一级即最高。
 */
export function requirementFor(
  c: Curriculum,
  kpId: KnowledgePointId,
  phaseId: PhaseId,
): LevelRequirement {
  const kp = c.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  const unlocked = stagesUpTo(c, phaseId).filter((s) => s.track === kp.track)
  if (unlocked.length === 0) {
    throw new Error(`知识点 ${kpId} 所在轨道 ${kp.track} 在 ${phaseId} 尚无解锁的级`)
  }
  const highest = unlocked.reduce((a, b) =>
    Number(b.id.slice(1)) > Number(a.id.slice(1)) ? b : a,
  )
  return {
    contextLevel: highest.requiresContextLevel,
    variationLevel: highest.requiresVariationLevel,
  }
}

/** 引入该知识点的阶段 */
export function phaseOfKnowledgePoint(
  c: Curriculum,
  kpId: KnowledgePointId,
): PhaseId {
  for (const stage of ALL_STAGES) {
    if (stage.introduces.includes(kpId)) {
      const phase = c.phaseOfStage.get(stage.id)
      if (!phase) throw new Error(`级 ${stage.id} 未归属任何阶段`)
      return phase
    }
  }
  throw new Error(`知识点 ${kpId} 未被任何级引入`)
}
