import type { ContextLevel } from '../music/tonalContext'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'

export interface AttemptOutcome {
  correct: boolean
  /** 绝对天数。仿真里是虚拟日，线上是自 Profile 创建起的天数 */
  day: number
  /**
   * 这次尝试是在哪个阶梯档位上做的。
   *
   * 必须记录：升级判据用的是窗口内的平均档位而非原始正确率（建模决策 4）。
   * 阶梯把观测正确率锁在约 71%，用原始正确率当判据会让升级永不发生。
   */
  difficultyStep: number
}

export interface MasteryState {
  /** 遗忘时间常数（天） */
  stability: number
  /** 该点对该用户的难度 0–1 */
  difficulty: number
  /** 当前开放到第几个变异轴（spec §6.2） */
  variationLevel: VariationLevel
  /** 当前语境强度 L0–L4，数值越大越难（spec §6.1） */
  contextLevel: ContextLevel
  /** 最近 WINDOW_SIZE 次尝试 */
  window: AttemptOutcome[]
  /** 从未练过时为 null */
  lastSeenDay: number | null
}

export type MasteryStore = ReadonlyMap<MasteryKey, MasteryState>

export const WINDOW_SIZE = 20
/** R 跌破此值即到期待复习（spec §7.1） */
export const DUE_THRESHOLD = 0.85
export const MIN_STABILITY = 0.5
export const INITIAL_STABILITY = 1
export const INITIAL_DIFFICULTY = 0.3
/** 答对时的 stability 增益系数 */
export const GAIN_A = 1.6
/**
 * 答错时的 stability 衰减系数。
 *
 * 为什么是 0.8 而不是计划里的 0.5（裁定 G，由 180 天仿真的关卡阻塞分解得出）：
 * 2-down-1-up 阶梯按设计把正确率压在约 71%（spec §2.9），也就是每道题
 * 约 29% 的概率答错——这些错是阶梯**故意**制造的合意困难，不是遗忘。
 * 但每个错都会按 LAPSE_C 砍一刀 stability。对一个天天被排到的 key，
 * 答对一次的增益约为 1 + GAIN_A·(1−difficulty)/stability（(1−R) 项在
 * Δt=1 时近似 1/stability），取对数后的期望净增长约为
 * 0.71·GAIN_A·(1−d)/stability + 0.29·ln(LAPSE_C)。
 * LAPSE_C=0.5 时右项为 −0.20，stability 在 ≈7 天处达到平衡再也上不去，
 * 而 P2–P5 的关卡要求 9/12/16/20 天——课程在 P2 之后结构性死锁
 * （实测：P2 的阻塞 key 全部卡在 stability、无一卡在平均档位）。
 * LAPSE_C=0.8 时右项为 −0.065，平衡点抬到 ≈21 天，各阶段关卡均可达。
 * spec §7.2 明确把 c 列为可调参数。
 */
export const LAPSE_C = 0.8
export const DIFFICULTY_UP = 0.08
export const DIFFICULTY_DOWN = 0.02

export function initialMastery(): MasteryState {
  return {
    stability: INITIAL_STABILITY,
    difficulty: INITIAL_DIFFICULTY,
    variationLevel: 0,
    contextLevel: 0,
    window: [],
    lastSeenDay: null,
  }
}

/**
 * 可提取性 R(t) = exp(−Δt / stability)。
 * 从未练过时返回 0——视为完全不可提取，故必然到期。
 */
export function retrievability(state: MasteryState, today: number): number {
  if (state.lastSeenDay === null) return 0
  const elapsed = Math.max(0, today - state.lastSeenDay)
  return Math.exp(-elapsed / state.stability)
}

export function isDue(state: MasteryState, today: number): boolean {
  return retrievability(state, today) < DUE_THRESHOLD
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * 应用一次尝试，返回新状态（不修改输入）。
 *
 * 答对时的增益含 (1 − R) 因子：接近遗忘临界时成功检索，增益最大
 * （spec §2.6）。其直接推论是同一天重复答对（Δt=0 → R=1）增益为零——
 * 集中练习不产生持久记忆，这正是要的行为。
 */
export function applyAttempt(
  state: MasteryState,
  correct: boolean,
  today: number,
  difficultyStep: number,
): MasteryState {
  const r = retrievability(state, today)

  const stability = correct
    ? state.stability * (1 + GAIN_A * (1 - state.difficulty) * (1 - r))
    : Math.max(MIN_STABILITY, state.stability * LAPSE_C)

  const difficulty = clamp01(
    correct ? state.difficulty - DIFFICULTY_DOWN : state.difficulty + DIFFICULTY_UP,
  )

  // difficultyStep 只被记录，不参与 stability 的算法——
  // 它是 Task 7 门控的判据来源（建模决策 4）
  const window = [...state.window, { correct, day: today, difficultyStep }].slice(
    -WINDOW_SIZE,
  )

  return { ...state, stability, difficulty, window, lastSeenDay: today }
}

/** 缺失的 key 视为从未练过 */
export function getMastery(store: MasteryStore, key: MasteryKey): MasteryState {
  return store.get(key) ?? initialMastery()
}
