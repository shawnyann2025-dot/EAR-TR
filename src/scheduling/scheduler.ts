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

interface RunInfo {
  index: number
  kpRun: number
  modalityRun: number
  trackRun: number
}

/** 逐题算出截至该题的三条连续计数——供 checkInterleaving 与局部修复共用 */
function computeRuns(items: ExerciseSpec[]): RunInfo[] {
  const runs: RunInfo[] = []
  let kpRun = 0
  let modalityRun = 0
  let trackRun = 0
  for (let i = 0; i < items.length; i++) {
    const prev = items[i - 1]
    kpRun = prev && prev.kpId === items[i].kpId ? kpRun + 1 : 1
    modalityRun = prev && prev.modality === items[i].modality ? modalityRun + 1 : 1
    trackRun = prev && prev.track === items[i].track ? trackRun + 1 : 1
    runs.push({ index: i, kpRun, modalityRun, trackRun })
  }
  return runs
}

/** 检查一串题目是否满足交错规则，返回违规描述（空数组表示合规） */
export function checkInterleaving(items: ExerciseSpec[]): string[] {
  const problems: string[] = []
  for (const r of computeRuns(items)) {
    const item = items[r.index]
    if (r.kpRun > MAX_SAME_KP_RUN) {
      problems.push(`第 ${r.index} 题：知识点 ${item.kpId} 连续出现 ${r.kpRun} 次`)
    }
    if (r.modalityRun > MAX_SAME_MODALITY_RUN) {
      problems.push(`第 ${r.index} 题：模态 ${item.modality} 连续出现 ${r.modalityRun} 次`)
    }
    if (r.trackRun > MAX_SAME_TRACK_RUN) {
      problems.push(`第 ${r.index} 题：轨道 ${item.track} 连续出现 ${r.trackRun} 次`)
    }
  }
  return problems
}

/** 违规发生的下标集合，供局部修复定位 */
function violatingIndices(items: ExerciseSpec[]): number[] {
  const bad: number[] = []
  for (const r of computeRuns(items)) {
    if (
      r.kpRun > MAX_SAME_KP_RUN ||
      r.modalityRun > MAX_SAME_MODALITY_RUN ||
      r.trackRun > MAX_SAME_TRACK_RUN
    ) {
      bad.push(r.index)
    }
  }
  return bad
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
 * 剩余候选里，与 candidate 同轨道/同模态的还有多少个（含它自己）。
 *
 * 贪心的失败模式是「稀缺的那类被用光、丰裕的那类堆在末尾」——序列后段
 * 只剩同一轨道/模态的题可选，无处可插。零违规候选之间优先选这个值更大
 * 的，相当于优先消耗丰裕的那一类，把稀缺的留到后面见缝插针。
 */
function abundance(remaining: ExerciseSpec[], candidate: ExerciseSpec): number {
  let trackCount = 0
  let modalityCount = 0
  for (const item of remaining) {
    if (item.track === candidate.track) trackCount++
    if (item.modality === candidate.modality) modalityCount++
  }
  return trackCount + modalityCount
}

/** 局部修复最多跑几轮——有界，避免针对无解输入死循环 */
const MAX_REPAIR_ROUNDS = 4
/**
 * 每个违规位置往前后各看这么远找交换对象。会话计分段一天通常不超过
 * 30 来道题，这个值定得足以覆盖一整天（含极端偏科的组成，如某一天
 * 75% 的题都是同一模态），O(n) 个候选位置各配一次 O(n) 的
 * checkInterleaving 验证，仍在 O(n^2)——四轮跑下来对几十道题的规模
 * 可忽略不计。
 */
const REPAIR_LOOKAHEAD = 30

/**
 * 贪心交错跑完之后的有界局部修复：对每个仍违规的位置，尝试与其附近
 * 一定范围内（前后都看）的某一项交换，若交换后总违规数下降就接受。
 *
 * 必须两个方向都看：违规常常出现在序列**末尾**（丰裕的那一类被拖到
 * 最后、无处可插时正是在末尾扎堆），此时该位置之后已经没有题可换，
 * 只能往前找。只看后面找不到交换对象，那一类violation永远修不掉。
 *
 * 这不保证把所有可修的违规都修掉（只看局部、只看有限轮数），但对贪心
 * 走进的死角足够——死角通常只需要一次近距离交换就能解开
 * （验证过的实例：把序列末尾附近两个位置对调即可合规）。
 * 输入本身不可交错时（如全部同知识点同模态），这里跑满轮数后原样返回，
 * 不会死循环，也不会丢题。
 */
function localRepair(items: ExerciseSpec[]): ExerciseSpec[] {
  let current = items
  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    const bad = violatingIndices(current)
    if (bad.length === 0) break

    let improved = false
    for (const i of bad) {
      const baseline = checkInterleaving(current).length
      let bestJ = -1
      let bestCount = baseline
      const lower = Math.max(0, i - REPAIR_LOOKAHEAD)
      const upper = Math.min(current.length, i + 1 + REPAIR_LOOKAHEAD)
      for (let j = lower; j < upper; j++) {
        if (j === i) continue
        const swapped = current.slice()
        ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
        const count = checkInterleaving(swapped).length
        if (count < bestCount) {
          bestCount = count
          bestJ = j
        }
      }
      if (bestJ >= 0) {
        const swapped = current.slice()
        ;[swapped[i], swapped[bestJ]] = [swapped[bestJ], swapped[i]]
        current = swapped
        improved = true
      }
    }
    if (!improved) break
  }
  return current
}

/**
 * 贪心交错：每一步挑一个不违规的候选；若全都违规，挑违规最少的；
 * 零违规候选之间按 abundance() 打破平局。跑完后再走一趟有界局部修复。
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
    let bestScore = Infinity
    for (const item of remaining) {
      const score = violationCount(out, item)
      if (score < bestScore) bestScore = score
    }

    let bestIndex = 0
    let bestAbundance = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      if (violationCount(out, remaining[i]) !== bestScore) continue
      const a = abundance(remaining, remaining[i])
      if (a > bestAbundance) {
        bestAbundance = a
        bestIndex = i
      }
    }

    out.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return localRepair(out)
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
