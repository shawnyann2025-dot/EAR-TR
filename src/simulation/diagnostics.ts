/**
 * 仿真诊断工具。不参与任何断言，供回调参数时看「课程到底卡在哪」。
 *
 * 来历：P-2 收尾时，180 天仿真的普通学习者卡在 P2 过不去。靠这里的
 * 关卡阻塞分解才看出被阻塞的 key 全部卡在 stability、无一卡在平均档位，
 * 把怀疑对象从 meanStep 阈值转到了 LAPSE_C（裁定 G）。没有分解的时候，
 * 上一位执行者盲调了三十多种常量组合。
 *
 * 零 IO：只读 store 与 trace，输出纯数据或字符串，由调用方决定打印到哪。
 */
import {
  knowledgePointsOfPhase,
  requirementFor,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type MasteryKey,
} from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { meanLadderStep } from '../scheduling/gating'
import { getMastery, type MasteryStore } from '../scheduling/mastery'
import type { AttemptTrace } from './runSimulation'

export interface KeyGateRow {
  key: MasteryKey
  stability: number
  stabilityThreshold: number
  meanStep: number
  meanStepThreshold: number
  blockedByStability: boolean
  blockedByMeanStep: boolean
  contextLevel: number
  contextCap: number
  variationLevel: number
  variationCap: number
  windowLength: number
  lastSeenDay: number | null
}

export interface GateBreakdown {
  phaseId: PhaseId
  total: number
  passing: number
  /** 只卡 stability */
  stabilityOnly: number
  /** 只卡平均档位 */
  meanStepOnly: number
  /** 两者都卡 */
  both: number
  /** 只列被阻塞的 key */
  rows: KeyGateRow[]
}

/**
 * 关卡阻塞分解：该阶段每个 (知识点, 模态) 是过了、卡 stability、卡平均
 * 档位、还是两者都卡。与 evaluateGate 用同一套判据，但把「为什么没过」
 * 拆开来。
 */
export function gateBreakdown(
  c: Curriculum,
  store: MasteryStore,
  phaseId: PhaseId,
): GateBreakdown {
  const phase = c.phases.find((p) => p.id === phaseId)
  if (!phase) throw new Error(`未知阶段 ${phaseId}`)

  const out: GateBreakdown = {
    phaseId,
    total: 0,
    passing: 0,
    stabilityOnly: 0,
    meanStepOnly: 0,
    both: 0,
    rows: [],
  }

  for (const kpId of knowledgePointsOfPhase(c, phaseId)) {
    const cap = requirementFor(c, kpId, phaseId)
    for (const m of MODALITIES) {
      const key = masteryKey(kpId, m)
      const state = getMastery(store, key)
      const meanStep = meanLadderStep(state.window)
      const blockedByStability = state.stability < phase.gate.stabilityThreshold
      const blockedByMeanStep = meanStep < phase.gate.meanStepThreshold
      out.total++
      if (!blockedByStability && !blockedByMeanStep) {
        out.passing++
        continue
      }
      if (blockedByStability && blockedByMeanStep) out.both++
      else if (blockedByStability) out.stabilityOnly++
      else out.meanStepOnly++
      out.rows.push({
        key,
        stability: state.stability,
        stabilityThreshold: phase.gate.stabilityThreshold,
        meanStep,
        meanStepThreshold: phase.gate.meanStepThreshold,
        blockedByStability,
        blockedByMeanStep,
        contextLevel: state.contextLevel,
        contextCap: cap.contextLevel,
        variationLevel: state.variationLevel,
        variationCap: cap.variationLevel,
        windowLength: state.window.length,
        lastSeenDay: state.lastSeenDay,
      })
    }
  }
  return out
}

/** 一行摘要 + 每个被阻塞 key 一行，便于直接打印 */
export function formatGateBreakdown(b: GateBreakdown): string {
  const head =
    `${b.phaseId}: keys=${b.total} ok=${b.passing} ` +
    `stabOnly=${b.stabilityOnly} stepOnly=${b.meanStepOnly} both=${b.both}`
  const lines = b.rows.map(
    (r) =>
      `  ${r.key} stab=${r.stability.toFixed(1)}/${r.stabilityThreshold} ` +
      `step=${r.meanStep.toFixed(2)}/${r.meanStepThreshold} ` +
      `ctx=${r.contextLevel}/${r.contextCap} var=${r.variationLevel}/${r.variationCap} ` +
      `win=${r.windowLength} last=${r.lastSeenDay ?? '-'}`,
  )
  return [head, ...lines].join('\n')
}

export interface StepAccuracy {
  step: number
  attempts: number
  correct: number
  accuracy: number
  /** 学习者在这些尝试上的真实平均答对概率——与观测正确率对照看噪声 */
  meanProbability: number
}

/** 按提问时的阶梯档位分组的正确率，档位升序 */
export function accuracyByStep(traces: readonly AttemptTrace[]): StepAccuracy[] {
  const acc = new Map<number, { n: number; c: number; p: number }>()
  for (const t of traces) {
    const b = acc.get(t.stepBefore) ?? { n: 0, c: 0, p: 0 }
    b.n++
    if (t.correct) b.c++
    b.p += t.probability
    acc.set(t.stepBefore, b)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, b]) => ({
      step,
      attempts: b.n,
      correct: b.c,
      accuracy: b.c / b.n,
      meanProbability: b.p / b.n,
    }))
}

export interface TrajectoryPoint {
  day: number
  stepBefore: number
  correct: boolean
  ability: number
  probability: number
  stability: number
  contextLevel: number
  variationLevel: number
}

/** 单个 (知识点, 模态) 的逐次作答轨迹，按发生顺序 */
export function keyTrajectory(
  traces: readonly AttemptTrace[],
  key: MasteryKey,
): TrajectoryPoint[] {
  const out: TrajectoryPoint[] = []
  for (const t of traces) {
    if (masteryKey(t.spec.kpId, t.spec.modality) !== key) continue
    out.push({
      day: t.day,
      stepBefore: t.stepBefore,
      correct: t.correct,
      ability: t.ability,
      probability: t.probability,
      stability: t.stateAfter.stability,
      contextLevel: t.stateAfter.contextLevel,
      variationLevel: t.stateAfter.variationLevel,
    })
  }
  return out
}
