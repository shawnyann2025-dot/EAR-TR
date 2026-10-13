import { requirementFor, unlockedKnowledgePoints, type Curriculum } from '../curriculum/curriculum'
import { MODALITIES, masteryKey, type MasteryKey } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { applyGating } from '../scheduling/gating'
import {
  decompose,
  isStagnant,
  needsRelief,
  relieveSpec,
  type SessionProgress,
} from '../scheduling/guardrails'
import { applyLadder, resumeLadder, type LadderState } from '../scheduling/ladder'
import {
  applyAttempt,
  getMastery,
  type MasteryState,
  type MasteryStore,
} from '../scheduling/mastery'

/**
 * 逐题函数：会话状态机与仿真共用同一套（P-3 spec §3.4），避免两份实现漂移。
 * 全部纯函数，不修改输入。
 */

export interface PreparedItem {
  key: MasteryKey
  /** 实时规格：已写入阶梯档位（P-2b §14 运行时契约），回血时已降难度 */
  spec: ExerciseSpec
  /** 出题时的阶梯（回血时已落到回血后的档位） */
  ladder: LadderState
  relief: boolean
}

export function prepareItem(
  planned: ExerciseSpec,
  ladderInSession: LadderState | undefined,
  mastery: MasteryStore,
  progress: SessionProgress,
): PreparedItem {
  const key = masteryKey(planned.kpId, planned.modality)
  // 阶梯续起（P-2 裁定 C/D）：会话内已有则用之，否则从掌握度窗口尾部推导
  let ladder = ladderInSession ?? resumeLadder(getMastery(mastery, key).window)
  let spec: ExerciseSpec = { ...planned, difficultyStep: ladder.step }
  let relief = false
  if (needsRelief(progress)) {
    // 会话内回血（主 spec §7.5）：阶梯跟着落到回血后的档位、连对清零
    relief = true
    spec = relieveSpec(spec)
    ladder = { step: spec.difficultyStep, consecutiveCorrect: 0 }
  }
  return { key, spec, ladder, relief }
}

export interface RecordedAnswer {
  key: MasteryKey
  /** 答后阶梯 */
  ladder: LadderState
  /** 写回后的掌握度（已过门控） */
  state: MasteryState
}

export function recordAnswer(input: {
  curriculum: Curriculum
  phaseId: PhaseId
  day: number
  mastery: MasteryStore
  spec: ExerciseSpec
  ladder: LadderState
  correct: boolean
}): RecordedAnswer {
  const { curriculum, phaseId, day, mastery, spec, ladder, correct } = input
  const key = masteryKey(spec.kpId, spec.modality)
  const stepped = applyLadder(ladder, correct)
  // 记答后档位（P-2 裁定 C 的修复）：续起与门控都读它
  const updated = applyAttempt(getMastery(mastery, key), correct, day, stepped.step)
  const state = applyGating(updated, requirementFor(curriculum, spec.kpId, phaseId))
  return { key, ladder: stepped, state }
}

/** 跨天护栏（主 spec §7.5）：已解锁、已练过且停滞的 key → 拆解后的状态 */
export function stagnationUpdates(
  curriculum: Curriculum,
  phaseId: PhaseId,
  day: number,
  mastery: MasteryStore,
): { key: MasteryKey; state: MasteryState }[] {
  const out: { key: MasteryKey; state: MasteryState }[] = []
  for (const kpId of unlockedKnowledgePoints(curriculum, phaseId)) {
    for (const m of MODALITIES) {
      const key = masteryKey(kpId, m)
      const state = mastery.get(key)
      if (state && isStagnant(state, day)) out.push({ key, state: decompose(state) })
    }
  }
  return out
}
