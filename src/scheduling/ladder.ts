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

/** resumeLadder 只需要记录里的这两个字段——与 mastery.ts 的 AttemptOutcome 结构兼容 */
export interface LadderRecord {
  correct: boolean
  /** 答完那一刻所在的档位（答后档位，不是提问时的档位） */
  difficultyStep: number
}

/**
 * 从尝试记录的尾部还原阶梯状态（裁定 C/D）：会话内阶梯仍不单独落盘，
 * 但新会话不再从 0 档、0 连对重建，而是接着该 key 上次的状态继续。
 *
 * 记录里存的是**答后**档位，所以还原规则必须考虑「到达这一档的那条记录」：
 * 连对 LADDER_UP_AFTER 次触发升档时，applyLadder 把计数清零，而这条记录
 * 以新档位写入。若把它也数进连对，次日一次答对就会再升一档——跨天变成
 * 1-up，不再是 2-down-1-up。所以：
 *   1. 从尾部往前数「同档位、答对」的连续记录；
 *   2. 若这串记录的前一条处在不同档位，说明串里最早那条正是升档到达记录，
 *      它本身不算连对，减一；
 *   3. 对 LADDER_UP_AFTER 取模：顶档连续答对时升档是空操作但计数照常清零。
 *
 * 已知歧义：窗口被截断且整窗都是顶档连对时看不到到达记录，连对奇偶无从
 * 判断；此时档位反正不能再升，差一次无实际影响。
 */
export function resumeLadder(window: readonly LadderRecord[]): LadderState {
  const last = window[window.length - 1]
  if (!last) return initialLadder()
  const step = clampStep(last.difficultyStep)

  let i = window.length - 1
  let run = 0
  while (i >= 0 && window[i].correct && window[i].difficultyStep === last.difficultyStep) {
    run++
    i--
  }
  const arrivedByStepUp = i >= 0 && window[i].difficultyStep !== last.difficultyStep
  if (arrivedByStepUp) run--

  return { step, consecutiveCorrect: Math.max(0, run) % LADDER_UP_AFTER }
}
