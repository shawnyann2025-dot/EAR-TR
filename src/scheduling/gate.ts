import {
  knowledgePointsOfPhase,
  phaseAt,
  phaseIndex,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type MasteryKey,
} from '../curriculum/knowledgePoints'
import { PHASE_ORDER, type PhaseId } from '../curriculum/stages'
import { meanLadderStep } from './gating'
import { getMastery, type MasteryStore } from './mastery'

export interface GateEvaluation {
  passed: boolean
  /** 尚未达标的 (知识点, 模态) —— 直接告诉用户卡在哪 */
  blockingKeys: MasteryKey[]
  bossSatisfied: boolean
}

/**
 * spec §8.3：三模态齐平 + 实战关一次通过。
 * 不允许靠听辨刷满而唱不出来（spec §2.4）。无逃生口。
 */
export function evaluateGate(
  c: Curriculum,
  store: MasteryStore,
  phaseId: PhaseId,
  bossPassed: boolean,
): GateEvaluation {
  const phase = c.phases.find((p) => p.id === phaseId)
  if (!phase) throw new Error(`未知阶段 ${phaseId}`)

  const blockingKeys: MasteryKey[] = []
  for (const kpId of knowledgePointsOfPhase(c, phaseId)) {
    for (const modality of MODALITIES) {
      const key = masteryKey(kpId, modality)
      const state = getMastery(store, key)
      const strongEnough = state.stability >= phase.gate.stabilityThreshold
      // 用平均阶梯档位而非正确率（建模决策 4）：2-down-1-up 把观测正确率
      // 锁在约 71%，卡正确率会让关卡永不可过
      const hardEnough =
        meanLadderStep(state.window) >= phase.gate.meanStepThreshold
      if (!strongEnough || !hardEnough) blockingKeys.push(key)
    }
  }

  const bossSatisfied = phase.gate.requiresBoss ? bossPassed : true
  return {
    passed: blockingKeys.length === 0 && bossSatisfied,
    blockingKeys,
    bossSatisfied,
  }
}

export function nextPhase(phaseId: PhaseId): PhaseId | null {
  const i = phaseIndex(phaseId)
  return i + 1 < PHASE_ORDER.length ? phaseAt(i + 1) : null
}
