import { makeRng } from '../music/rng'
import {
  masteryKey,
  type MasteryKey,
  type Modality,
} from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'

/** 唱与听写比听辨更难——多一层产出或记忆负担（spec §6.3） */
export const MODALITY_DEMAND: Record<Modality, number> = {
  recognize: 0,
  sing: 0.15,
  notate: 0.12,
}

/** logistic 斜率：越大，能力与要求的差距对正确率影响越陡 */
export const LOGISTIC_SLOPE = 8

export interface LearnerParams {
  seed: number
  /** 初始能力 0–1 */
  baseAbility: number
  /** 答对后的能力提升系数 */
  learningRate: number
  /** 答错后的能力提升系数（更小，但不为零——错也能学到东西） */
  errorLearningRate: number
  /** 选择题猜对率 */
  guessRate: number
}

export interface VirtualLearner {
  abilityOf(key: MasteryKey): number
  probabilityOf(spec: ExerciseSpec, ladderStep: number): number
  /** 作答并内部更新能力 */
  answer(spec: ExerciseSpec, ladderStep: number): boolean
}

/** 题目要求，归一化到 0–1 */
export function demandOf(spec: ExerciseSpec, ladderStep: number): number {
  const raw =
    0.3 * (spec.contextLevel / 4) +
    0.2 * (spec.variationLevel / 6) +
    0.2 * (Math.max(0, ladderStep) / 5) +
    MODALITY_DEMAND[spec.modality]
  return Math.min(1, Math.max(0, raw))
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function makeVirtualLearner(params: LearnerParams): VirtualLearner {
  const rng = makeRng(params.seed)
  const ability = new Map<MasteryKey, number>()

  const abilityOf = (key: MasteryKey): number =>
    ability.get(key) ?? params.baseAbility

  const probabilityOf = (spec: ExerciseSpec, ladderStep: number): number => {
    const key = masteryKey(spec.kpId, spec.modality)
    const gap = abilityOf(key) - demandOf(spec, ladderStep)
    return params.guessRate + (1 - params.guessRate) * logistic(LOGISTIC_SLOPE * gap)
  }

  const answer = (spec: ExerciseSpec, ladderStep: number): boolean => {
    const key = masteryKey(spec.kpId, spec.modality)
    const correct = rng.next() < probabilityOf(spec, ladderStep)
    // 能力按 (知识点, 模态) 分开增长——练听辨不会让唱变强
    const rate = correct ? params.learningRate : params.errorLearningRate
    const current = abilityOf(key)
    ability.set(key, current + rate * (1 - current))
    return correct
  }

  return { abilityOf, probabilityOf, answer }
}

export const AVERAGE_LEARNER: LearnerParams = {
  seed: 20260825,
  baseAbility: 0.25,
  learningRate: 0.035,
  errorLearningRate: 0.012,
  guessRate: 0.15,
}

export const FAST_LEARNER: LearnerParams = {
  ...AVERAGE_LEARNER,
  seed: 20260826,
  baseAbility: 0.4,
  learningRate: 0.07,
  errorLearningRate: 0.025,
}

export const SLOW_LEARNER: LearnerParams = {
  ...AVERAGE_LEARNER,
  seed: 20260827,
  baseAbility: 0.12,
  learningRate: 0.014,
  errorLearningRate: 0.005,
}
