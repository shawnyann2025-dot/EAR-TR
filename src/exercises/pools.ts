import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import { ALL_STAGES, type Stage } from '../curriculum/stages'
import { stageOrderIndex } from '../curriculum/validate'
import type { Rng } from '../music/rng'

/** Fisher–Yates，返回新数组 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function stageOfKnowledgePoint(kpId: KnowledgePointId): Stage {
  const stage = ALL_STAGES.find((s) => s.introduces.includes(kpId))
  if (!stage) throw new Error(`知识点 ${kpId} 未被任何级引入`)
  return stage
}

/**
 * 干扰池（P-2b spec §7）：与目标同池、所在级的课程顺序不晚于目标所在级。
 *
 * 只看课程，不看学习者的掌握度 store（D2）——generate 因此保持
 * (spec, curriculum) 的纯函数，重放与重练无需额外状态即可复现。
 */
export function poolMembers(
  c: Curriculum,
  targetKpId: KnowledgePointId,
  poolOf: (kpId: KnowledgePointId) => string | undefined,
): KnowledgePointId[] {
  const pool = poolOf(targetKpId)
  if (pool === undefined) throw new Error(`知识点 ${targetKpId} 不属于任何干扰池`)
  const limit = stageOrderIndex(c, stageOfKnowledgePoint(targetKpId).id)

  const members: { id: KnowledgePointId; order: number }[] = []
  for (const id of c.knowledgePoints.keys()) {
    if (poolOf(id) !== pool) continue
    const order = stageOrderIndex(c, stageOfKnowledgePoint(id).id)
    if (order <= limit) members.push({ id, order })
  }
  // Array.prototype.sort 是稳定排序：同级保持课程数据顺序
  return members.sort((a, b) => a.order - b.order).map((m) => m.id)
}

/**
 * 选项 = 目标 + 从其余候选里抽取的干扰项，整体打乱。
 * 个数至少 2，至多为去重后的候选数（含目标）。
 */
export function pickOptions(
  targetId: string,
  candidates: readonly string[],
  count: number,
  rng: Rng,
): string[] {
  const others = [...new Set(candidates)].filter((id) => id !== targetId)
  const wanted = Math.max(2, count)
  const distractors = shuffle(others, rng).slice(0, Math.min(wanted - 1, others.length))
  return shuffle([targetId, ...distractors], rng)
}
