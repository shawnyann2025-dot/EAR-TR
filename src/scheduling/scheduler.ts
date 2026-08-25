import { makeRng, type Rng } from '../music/rng'
import type { PhaseId } from '../curriculum/stages'
import { buildCandidates, type SchedulerInput } from './candidates'
import type { ExerciseSpec } from './exerciseSpec'

/** spec §7.4 的三条强制交错规则（spec §2.5 的落地） */
export const MAX_SAME_KP_RUN = 2
export const MAX_SAME_MODALITY_RUN = 3
export const MAX_SAME_TRACK_RUN = 2

export interface SessionPlan {
  day: number
  seed: number
  phaseId: PhaseId
  items: ExerciseSpec[]
}

/** 检查一串题目是否满足交错规则，返回违规描述（空数组表示合规） */
export function checkInterleaving(items: ExerciseSpec[]): string[] {
  const problems: string[] = []
  let kpRun = 0
  let modalityRun = 0
  let trackRun = 0

  for (let i = 0; i < items.length; i++) {
    const prev = items[i - 1]
    kpRun = prev && prev.kpId === items[i].kpId ? kpRun + 1 : 1
    modalityRun = prev && prev.modality === items[i].modality ? modalityRun + 1 : 1
    trackRun = prev && prev.track === items[i].track ? trackRun + 1 : 1

    if (kpRun > MAX_SAME_KP_RUN) {
      problems.push(`第 ${i} 题：知识点 ${items[i].kpId} 连续出现 ${kpRun} 次`)
    }
    if (modalityRun > MAX_SAME_MODALITY_RUN) {
      problems.push(`第 ${i} 题：模态 ${items[i].modality} 连续出现 ${modalityRun} 次`)
    }
    if (trackRun > MAX_SAME_TRACK_RUN) {
      problems.push(`第 ${i} 题：轨道 ${items[i].track} 连续出现 ${trackRun} 次`)
    }
  }
  return problems
}

/** 某题接在给定尾部之后会违反几条规则 */
function violationCount(
  tail: ExerciseSpec[],
  candidate: ExerciseSpec,
): number {
  let n = 0
  const runOf = <K extends keyof ExerciseSpec>(field: K): number => {
    let run = 0
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tail[i][field] !== candidate[field]) break
      run++
    }
    return run
  }
  if (runOf('kpId') + 1 > MAX_SAME_KP_RUN) n++
  if (runOf('modality') + 1 > MAX_SAME_MODALITY_RUN) n++
  if (runOf('track') + 1 > MAX_SAME_TRACK_RUN) n++
  return n
}

/**
 * 贪心交错：每一步挑一个不违规的候选；若全都违规，挑违规最少的。
 *
 * 「挑违规最少的」这条兜底是必需的——输入本身可能无法满足规则
 * （例如某天只有一个知识点到期），此时必须仍然把题排完，
 * 既不能丢题，也不能死循环重试。
 */
export function interleave(specs: ExerciseSpec[], rng: Rng): ExerciseSpec[] {
  const remaining = [...specs]
  // 先打乱，让同等优先的候选之间的选择也由 seed 决定
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
  }

  const out: ExerciseSpec[] = []
  while (remaining.length > 0) {
    let bestIndex = 0
    let bestScore = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const score = violationCount(out, remaining[i])
      if (score < bestScore) {
        bestScore = score
        bestIndex = i
        if (score === 0) break
      }
    }
    out.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return out
}

/**
 * 生成一次会话的计划。纯函数：同一状态 + 同一 seed 必然产出同一计划，
 * 供落盘后中断可续（spec §7.4）。热身固定排在最前，不参与交错。
 */
export function buildSessionPlan(input: SchedulerInput): SessionPlan {
  const rng = makeRng(input.seed)
  const pools = buildCandidates(input, rng)

  const scored = [
    ...pools.review,
    ...pools.focus,
    ...pools.introduce,
    ...pools.boss,
  ]

  return {
    day: input.today,
    seed: input.seed,
    phaseId: input.phaseId,
    items: [...pools.warmup, ...interleave(scored, rng)],
  }
}
