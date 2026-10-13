import {
  buildCurriculum,
  knowledgePointsOfPhase,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type MasteryKey,
} from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { evaluateGate, nextPhase } from '../scheduling/gate'
import type { SessionProgress } from '../scheduling/guardrails'
import {
  LADDER_MAX_STEP,
  LADDER_MIN_STEP,
  type LadderState,
} from '../scheduling/ladder'
import type { MasteryState } from '../scheduling/mastery'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { buildSessionPlan, checkInterleaving } from '../scheduling/scheduler'
import { prepareItem, recordAnswer, stagnationUpdates } from '../session/item'
import {
  makeVirtualLearner,
  type LearnerParams,
  type VirtualLearner,
} from './virtualLearner'

/**
 * 实战关在仿真里的替身：该阶段全部 key 的平均能力过阈值即视为通过。
 * 真正的实战关（多轨合成的模拟音乐片段）在 P-5 实现——这里只是让
 * 仿真能推进阶段，不是实战关的实现。
 */
export const BOSS_ABILITY_THRESHOLD = 0.62

export interface DayRecord {
  day: number
  phaseId: PhaseId
  itemCount: number
  correct: number
  interleavingProblems: string[]
  reliefTriggered: boolean
  decomposedKeys: MasteryKey[]
}

/** 一次作答的完整轨迹点——供诊断用，仿真本身不消费 */
export interface AttemptTrace {
  day: number
  phaseId: PhaseId
  spec: ExerciseSpec
  /** 提问时的阶梯档位 */
  stepBefore: number
  correct: boolean
  /** 作答时学习者在该 key 上的真实能力（作答前） */
  ability: number
  /** 作答时的真实答对概率 */
  probability: number
  /** 写回 store 后的状态 */
  stateAfter: MasteryState
}

export interface SimulationParams {
  learner: LearnerParams
  days: number
  minutesPerDay: number
  seed: number
  /**
   * 可选的逐次作答回调。不传时零开销；传入后每道计分题作答一次调用一次，
   * 供 diagnostics.ts 之类的工具汇总逐 key 轨迹、阶梯分档正确率等。
   * 回调只读——它拿到的 stateAfter 就是写进 store 的那个对象，别改它。
   */
  trace?: (t: AttemptTrace) => void
}

export interface SimulationResult {
  days: DayRecord[]
  finalStore: Map<MasteryKey, MasteryState>
  finalPhase: PhaseId
  phaseCompletionDay: Partial<Record<PhaseId, number>>
  /**
   * 阶梯**未饱和区间**（LADDER_MIN_STEP < step < LADDER_MAX_STEP）的
   * 正确率，用于验证 2-down-1-up 的收敛点（spec §2.9：约 70.7%）。
   *
   * 裁定 F：不能把撞到 LADDER_MAX_STEP 之后的尝试计入——阶梯撞顶后
   * 就不再能继续升档去压低正确率，正确率此时由学习者的真实能力直接
   * 主导，不再反映阶梯本身的收敛行为。撞顶本身是合理现象：
   * contextLevel/variationLevel 被阶段上限卡死后，题目难度的上限也
   * 跟着卡死，练熟的学习者跑赢这个上限、把阶梯焊死在顶格，正是关卡
   * 该放行的信号，不是异常。把这部分计入会系统性地高估收敛点。
   */
  ladderAccuracy: number
}

function bossPasses(
  curriculum: Curriculum,
  learner: VirtualLearner,
  phaseId: PhaseId,
): boolean {
  const kps = knowledgePointsOfPhase(curriculum, phaseId)
  if (kps.length === 0) return true
  let sum = 0
  let n = 0
  for (const kpId of kps) {
    for (const m of MODALITIES) {
      sum += learner.abilityOf(masteryKey(kpId, m))
      n++
    }
  }
  return n > 0 && sum / n >= BOSS_ABILITY_THRESHOLD
}

export function runSimulation(params: SimulationParams): SimulationResult {
  const curriculum = buildCurriculum()
  const learner = makeVirtualLearner(params.learner)
  const store = new Map<MasteryKey, MasteryState>()
  const days: DayRecord[] = []
  const phaseCompletionDay: Partial<Record<PhaseId, number>> = {}

  let phaseId: PhaseId = 'P1'
  let ladderAttempts = 0
  let ladderCorrect = 0

  for (let day = 0; day < params.days; day++) {
    const plan = buildSessionPlan({
      curriculum,
      store,
      phaseId,
      today: day,
      seed: params.seed + day,
      minutes: params.minutesPerDay,
    })

    const scored = plan.items.filter((s) => s.segment !== 'warmup')
    const interleavingProblems = checkInterleaving(scored)

    // 阶梯状态是会话内的，不落盘（spec §7.4.1）
    const ladders = new Map<MasteryKey, LadderState>()
    const progress: SessionProgress = { attempted: 0, correct: 0 }
    let reliefTriggered = false
    let correctToday = 0

    for (const planned of scored) {
      const key = masteryKey(planned.kpId, planned.modality)
      // 阶梯续起、写档位、会话内回血都在 session/item.ts 的 prepareItem 里
      // （规则与理由见该文件与 ladder.ts）；仿真与真实会话共用同一套。
      const prepared = prepareItem(planned, ladders.get(key), store, progress)
      const ladder = prepared.ladder
      const spec = prepared.spec
      if (prepared.relief) reliefTriggered = true

      const ability = learner.abilityOf(key)
      const probability = learner.probabilityOf(spec, ladder.step)
      const correct = learner.answer(spec, ladder.step)

      // 只统计阶梯未饱和区间的尝试（裁定 F）：档位 0 是地板，阶梯在
      // 那里无法再降；档位 LADDER_MAX_STEP 是顶（受 contextLevel/
      // variationLevel 的阶段上限限制，demandOf 的档位项到顶后不再
      // 增长），阶梯在那里也无法再升。两种情形阶梯都已经不起自适应
      // 调节作用，计入会把收敛点系统性地推高——撞顶尝试的正确率由
      // 学习者跑赢阶段上限的程度决定，不反映阶梯本身收敛到 71% 这
      // 件事。用的仍是提问前的 ladder.step——这里问的是「学习者当时
      // 面对的档位是否仍在阶梯的可调节区间内」，跟裁定 C/D 记录答后
      // 档位的理由不冲突（那是为了续起，这里是为了筛掉饱和样本）。
      if (ladder.step > LADDER_MIN_STEP && ladder.step < LADDER_MAX_STEP) {
        ladderAttempts++
        if (correct) ladderCorrect++
      }

      // 答后档位写回 window、门控取舍见 session/item.ts 的 recordAnswer
      const recorded = recordAnswer({ curriculum, phaseId, day, mastery: store, spec, ladder, correct })
      ladders.set(key, recorded.ladder)
      const stateAfter = recorded.state
      store.set(key, stateAfter)
      params.trace?.({
        day,
        phaseId,
        spec,
        stepBefore: ladder.step,
        correct,
        ability,
        probability,
        stateAfter,
      })

      progress.attempted++
      if (correct) {
        progress.correct++
        correctToday++
      }
    }

    // 跨天护栏：停滞的知识点触发拆解
    const decomposedKeys: MasteryKey[] = []
    for (const u of stagnationUpdates(curriculum, phaseId, day, store)) {
      store.set(u.key, u.state)
      decomposedKeys.push(u.key)
    }

    days.push({
      day,
      phaseId,
      itemCount: scored.length,
      correct: correctToday,
      interleavingProblems,
      reliefTriggered,
      decomposedKeys,
    })

    // 关卡判定：三模态齐平 + 实战关（spec §8.3）
    const gate = evaluateGate(
      curriculum,
      store,
      phaseId,
      bossPasses(curriculum, learner, phaseId),
    )
    if (gate.passed && phaseCompletionDay[phaseId] === undefined) {
      phaseCompletionDay[phaseId] = day
      const next = nextPhase(phaseId)
      if (next) phaseId = next
    }
  }

  return {
    days,
    finalStore: store,
    finalPhase: phaseId,
    phaseCompletionDay,
    ladderAccuracy: ladderAttempts > 0 ? ladderCorrect / ladderAttempts : 0,
  }
}
