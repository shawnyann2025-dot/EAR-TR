export const LADDER_MIN_STEP = 0
export const LADDER_MAX_STEP = 5
/** 连对多少次升一档。2 是 2-down-1-up 的定义。 */
export const LADDER_UP_AFTER = 2

export interface LadderState {
  step: number
  consecutiveCorrect: number
}

function clampStep(step: number): number {
  return Math.min(LADDER_MAX_STEP, Math.max(LADDER_MIN_STEP, Math.round(step)))
}

export function initialLadder(step: number = LADDER_MIN_STEP): LadderState {
  return { step: clampStep(step), consecutiveCorrect: 0 }
}

/**
 * 快机制：题间即时调整单题难度档（spec §7.4.1）。
 *
 * 2-down-1-up 收敛于约 71% 正确率（spec §2.9），正好落在合意困难区间。
 * 它调的是选项集大小、播放速度、旋律音数、音程跨度这类**单题内**参数，
 * **永远不修改 variationLevel 或 contextLevel**——那是慢机制的领地。
 */
export function applyLadder(state: LadderState, correct: boolean): LadderState {
  if (!correct) {
    return { step: clampStep(state.step - 1), consecutiveCorrect: 0 }
  }
  const consecutive = state.consecutiveCorrect + 1
  if (consecutive >= LADDER_UP_AFTER) {
    return { step: clampStep(state.step + 1), consecutiveCorrect: 0 }
  }
  return { step: state.step, consecutiveCorrect: consecutive }
}
