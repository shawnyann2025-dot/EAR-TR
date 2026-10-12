import { describe, expect, it } from 'vitest'
import {
  MAX_SAME_KP_RUN,
  MAX_SAME_MODALITY_RUN,
  MAX_SAME_TRACK_RUN,
  buildSessionPlan,
  checkInterleaving,
  interleave,
} from './scheduler'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { isWellFormedSpec, type ExerciseSpec } from './exerciseSpec'
import { makeRng } from '../music/rng'
import type { SchedulerInput } from './candidates'

const c = buildCurriculum()
const P1_KPS = knowledgePointsOfPhase(c, 'P1')

function fullStore(): Map<string, MasteryState> {
  const store = new Map<string, MasteryState>()
  P1_KPS.forEach((kpId, i) => {
    // 让三个模态的 stability 各不相同，且最弱的那个随知识点轮转，
    // 模拟真实的「各模态练习历史不同」——真实运行中浮点 stability 不会精确相等
    MODALITIES.forEach((m, j) => {
      const isWeakest = (i + j) % MODALITIES.length === 0
      store.set(masteryKey(kpId, m), {
        ...initialMastery(),
        stability: isWeakest ? 1.5 : 3 + j,
        lastSeenDay: isWeakest ? 0 : 5,
      })
    })
  })
  return store
}

function input(store: Map<string, MasteryState>): SchedulerInput {
  return { curriculum: c, store, phaseId: 'P1', today: 10, seed: 7, minutes: 25 }
}

function spec(over: Partial<ExerciseSpec>): ExerciseSpec {
  return {
    kpId: 'degree:major:do', modality: 'recognize', track: 'T',
    contextLevel: 0, variationLevel: 0, difficultyStep: 0,
    seed: 1, segment: 'focus', ...over,
  }
}

describe('checkInterleaving', () => {
  it('空列表与单题无违规', () => {
    expect(checkInterleaving([])).toEqual([])
    expect(checkInterleaving([spec({})])).toEqual([])
  })

  it('同一知识点连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_KP_RUN + 1 }, () => spec({}))
    expect(checkInterleaving(items).some((p) => p.includes('知识点'))).toBe(true)
  })

  it('同一模态连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_MODALITY_RUN + 1 }, (_, i) =>
      spec({ kpId: `degree:major:x${i}`, modality: 'sing' }),
    )
    expect(checkInterleaving(items).some((p) => p.includes('模态'))).toBe(true)
  })

  it('同一轨道连续超限时报出', () => {
    const items = Array.from({ length: MAX_SAME_TRACK_RUN + 1 }, (_, i) =>
      spec({ kpId: `degree:major:x${i}`, track: 'T', modality: MODALITIES[i % 3] }),
    )
    expect(checkInterleaving(items).some((p) => p.includes('轨道'))).toBe(true)
  })

  it('合规序列无违规', () => {
    const items = [
      spec({ kpId: 'a', track: 'T', modality: 'recognize' }),
      spec({ kpId: 'b', track: 'H', modality: 'sing' }),
      spec({ kpId: 'c', track: 'R', modality: 'notate' }),
      spec({ kpId: 'd', track: 'T', modality: 'recognize' }),
    ]
    expect(checkInterleaving(items)).toEqual([])
  })
})

describe('interleave', () => {
  it('不增不减，是原集合的一个排列', () => {
    const items = P1_KPS.map((kpId, i) =>
      spec({ kpId, track: c.knowledgePoints.get(kpId)!.track, modality: MODALITIES[i % 3] }),
    )
    const out = interleave(items, makeRng(3))
    expect(out).toHaveLength(items.length)
    expect(new Set(out.map((s) => s.kpId + s.modality))).toEqual(
      new Set(items.map((s) => s.kpId + s.modality)),
    )
  })

  it('三轨道混合输入时输出满足全部交错规则', () => {
    const items: ExerciseSpec[] = []
    for (let i = 0; i < 12; i++) {
      items.push(spec({ kpId: `degree:major:t${i}`, track: 'T', modality: 'recognize' }))
      items.push(spec({ kpId: `chord:h${i}`, track: 'H', modality: 'sing' }))
      items.push(spec({ kpId: `rhythm:r${i}`, track: 'R', modality: 'notate' }))
    }
    expect(checkInterleaving(interleave(items, makeRng(5)))).toEqual([])
  })

  it('同一 seed 产出相同排列', () => {
    const items = P1_KPS.map((kpId) =>
      spec({ kpId, track: c.knowledgePoints.get(kpId)!.track }),
    )
    expect(interleave(items, makeRng(11))).toEqual(interleave(items, makeRng(11)))
  })

  it('输入本身无法满足规则时仍返回全部题目，不丢题也不死循环', () => {
    // 全部同一知识点同一模态，任何排列都违规
    const items = Array.from({ length: 10 }, () => spec({}))
    const out = interleave(items, makeRng(1))
    expect(out).toHaveLength(10)
  })
})

describe('buildSessionPlan', () => {
  it('热身连成一段排在最前，不被交错打散', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const warmupCount = plan.items.filter((s) => s.segment === 'warmup').length
    expect(warmupCount).toBeGreaterThan(0)
    // 热身占据 items 的前缀
    expect(plan.items.slice(0, warmupCount).every((s) => s.segment === 'warmup')).toBe(true)
    // 前缀之后再无热身题（即没有被打散到计分段里）
    expect(plan.items.slice(warmupCount).some((s) => s.segment === 'warmup')).toBe(false)
  })

  it('计分段满足全部交错规则', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const scored = plan.items.filter((s) => s.segment !== 'warmup')
    expect(checkInterleaving(scored)).toEqual([])
  })

  it('不允许单日单轨：至少覆盖两条轨道', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const tracks = new Set(plan.items.map((s) => s.track))
    expect(tracks.size).toBeGreaterThanOrEqual(2)
  })

  it('全部题目都是良构规格', () => {
    const plan = buildSessionPlan(input(fullStore()))
    for (const spec of plan.items) expect(isWellFormedSpec(spec)).toBe(true)
  })

  it('同一 seed 与同一状态产出完全相同的计划（纯函数、可复现）', () => {
    const a = buildSessionPlan(input(fullStore()))
    const b = buildSessionPlan(input(fullStore()))
    expect(a).toEqual(b)
  })

  it('不同 seed 通常产出不同的计划', () => {
    const a = buildSessionPlan({ ...input(fullStore()), seed: 1 })
    const b = buildSessionPlan({ ...input(fullStore()), seed: 2 })
    expect(a.items.map((s) => s.seed)).not.toEqual(b.items.map((s) => s.seed))
  })

  it('计划带上日期与阶段，供落盘后续练', () => {
    const plan = buildSessionPlan(input(fullStore()))
    expect(plan.day).toBe(10)
    expect(plan.phaseId).toBe('P1')
    expect(plan.seed).toBe(7)
  })

  it('总时长不超过给定分钟数', () => {
    const plan = buildSessionPlan(input(fullStore()))
    const total = plan.items.reduce(
      (sum, s) => sum + ({ recognize: 12, sing: 20, notate: 25 } as const)[s.modality],
      0,
    )
    expect(total).toBeLessThanOrEqual(25 * 60)
  })

  it('三个模态状态完全相同时，focus/boss 段靠模态分散避免塌缩到单一模态', () => {
    // 曾经的已知行为：weakestModality/staleastModality 在打平时都取
    // MODALITIES[0]（recognize），若不做任何干预，focus/boss 会让当天
    // 计分题几乎全部挤进 recognize，交错规则在候选池层面直接无解
    // （用回溯搜索证实过真实仿真里类似的塌缩天，23/26 题挤进同一模态，
    // 超出 MAX_SAME_MODALITY_RUN 的数学上限）。
    // candidates.ts::diversifiedFocusModalities 按公平配额跨知识点轮询
    // focus/boss 段的模态选择后，即便三态打平，当天的模态分布也会被
    // 摊开，不再单一模态塌缩，交错规则因此重新可满足。
    const tied = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) {
        tied.set(masteryKey(kpId, m), { ...initialMastery(), stability: 2, lastSeenDay: 0 })
      }
    }
    const plan = buildSessionPlan(input(tied))
    const scored = plan.items.filter((s) => s.segment !== 'warmup')
    expect(scored.length).toBeGreaterThan(0)
    expect(new Set(scored.map((s) => s.modality))).toEqual(
      new Set(['recognize', 'sing', 'notate']),
    )
    expect(checkInterleaving(scored)).toEqual([])
  })
})
