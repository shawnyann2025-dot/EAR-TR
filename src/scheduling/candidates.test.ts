import { describe, expect, it } from 'vitest'
import {
  MAX_NEW_PER_SESSION,
  WARMUP_SECONDS,
  allocateBudget,
  buildCandidates,
  hasBeenIntroduced,
  staleastModality,
  weakestModality,
  type SchedulerInput,
} from './candidates'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { ITEM_SECONDS, isWellFormedSpec, type SessionSegment } from './exerciseSpec'
import { makeRng } from '../music/rng'

const c = buildCurriculum()
const P1_KPS = knowledgePointsOfPhase(c, 'P1')

function seen(over: Partial<MasteryState> = {}): MasteryState {
  return { ...initialMastery(), lastSeenDay: 0, ...over }
}

function input(store: Map<string, MasteryState>, over: Partial<SchedulerInput> = {}): SchedulerInput {
  return { curriculum: c, store, phaseId: 'P1', today: 10, seed: 7, minutes: 25, ...over }
}

describe('hasBeenIntroduced', () => {
  it('掌握度库里没有任何模态记录时为 false', () => {
    expect(hasBeenIntroduced(new Map(), P1_KPS[0])).toBe(false)
  })

  it('任一模态有记录即为 true', () => {
    const store = new Map([[masteryKey(P1_KPS[0], 'sing'), seen()]])
    expect(hasBeenIntroduced(store, P1_KPS[0])).toBe(true)
  })
})

describe('weakestModality / staleastModality', () => {
  it('weakestModality 选 stability 最低的模态（拖后腿的优先）', () => {
    const kpId = P1_KPS[0]
    const store = new Map([
      [masteryKey(kpId, 'recognize'), seen({ stability: 30 })],
      [masteryKey(kpId, 'sing'), seen({ stability: 2 })],
      [masteryKey(kpId, 'notate'), seen({ stability: 15 })],
    ])
    expect(weakestModality(store, kpId)).toBe('sing')
  })

  it('staleastModality 选可提取性最低的模态（最接近遗忘的先救）', () => {
    const kpId = P1_KPS[0]
    const store = new Map([
      [masteryKey(kpId, 'recognize'), seen({ stability: 10, lastSeenDay: 9 })],
      [masteryKey(kpId, 'sing'), seen({ stability: 10, lastSeenDay: 0 })],
      [masteryKey(kpId, 'notate'), seen({ stability: 10, lastSeenDay: 8 })],
    ])
    expect(staleastModality(store, kpId, 10)).toBe('sing')
  })

  it('全部未练过时返回 recognize（必须先认得出，才谈得上唱得出）', () => {
    expect(weakestModality(new Map(), P1_KPS[0])).toBe('recognize')
  })
})

describe('allocateBudget', () => {
  const all: Record<SessionSegment, boolean> = {
    warmup: true, review: true, focus: true, introduce: true, boss: true,
  }

  it('热身是固定时长，不参与比例分配', () => {
    expect(allocateBudget(25, all).warmup).toBe(WARMUP_SECONDS)
  })

  it('其余四段之和等于扣除热身后的剩余时间', () => {
    const b = allocateBudget(25, all)
    const rest = b.review + b.focus + b.introduce + b.boss
    expect(rest).toBeCloseTo(25 * 60 - WARMUP_SECONDS, 6)
  })

  it('无候选的段其配额并入焦点段', () => {
    const withAll = allocateBudget(25, all)
    const noBoss = allocateBudget(25, { ...all, boss: false })
    expect(noBoss.boss).toBe(0)
    expect(noBoss.focus).toBeCloseTo(withAll.focus + withAll.boss, 6)
  })

  it('复习与引入都无候选时，其配额并入焦点，且总时长不变', () => {
    const b = allocateBudget(25, { ...all, review: false, introduce: false })
    expect(b.review).toBe(0)
    expect(b.introduce).toBe(0)
    // boss 仍有候选，保留自己的配额，不被吞并
    expect(b.boss).toBeGreaterThan(0)
    // 被吞并的配额进了焦点段：四段总和仍等于扣除热身后的剩余时间
    expect(b.focus + b.boss).toBeCloseTo(25 * 60 - WARMUP_SECONDS, 6)
    // 焦点段确实因吞并而变大
    expect(b.focus).toBeGreaterThan(allocateBudget(25, all).focus)
  })

  it('时长过短时不产生负配额', () => {
    const b = allocateBudget(1, all)
    for (const seg of Object.keys(b) as SessionSegment[]) {
      expect(b[seg]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('buildCandidates', () => {
  it('全新学习者：无复习候选，有引入候选，且引入数受限', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.review).toHaveLength(0)
    expect(cand.introduce.length).toBeGreaterThan(0)
    expect(cand.introduce.length).toBeLessThanOrEqual(MAX_NEW_PER_SESSION)
  })

  it('引入的知识点其前置必须已被引入过', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const spec of cand.introduce) {
      const kp = c.knowledgePoints.get(spec.kpId)!
      expect(kp.prerequisites).toEqual([])
    }
  })

  it('引入段一律用 recognize 模态', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const spec of cand.introduce) expect(spec.modality).toBe('recognize')
  })

  it('已到期的知识点进复习段', () => {
    const store = new Map<string, MasteryState>()
    for (const m of MODALITIES) {
      store.set(masteryKey(P1_KPS[0], m), seen({ stability: 1, lastSeenDay: 0 }))
    }
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.review.some((s) => s.kpId === P1_KPS[0])).toBe(true)
  })

  it('复习段按可提取性升序，最接近遗忘的排最前', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) {
        store.set(masteryKey(kpId, m), seen({ stability: 1, lastSeenDay: 0 }))
      }
    }
    store.set(masteryKey(P1_KPS[1], 'sing'), seen({ stability: 0.5, lastSeenDay: 0 }))
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.review[0].kpId).toBe(P1_KPS[1])
  })

  it('该阶段知识点尚未全部引入时不排实战关', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.boss).toHaveLength(0)
  })

  it('全部引入后才有实战关候选', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) store.set(masteryKey(kpId, m), seen({ stability: 5 }))
    }
    const cand = buildCandidates(input(store), makeRng(1))
    expect(cand.boss.length).toBeGreaterThan(0)
    for (const spec of cand.boss) expect(spec.segment).toBe('boss')
  })

  it('热身段非空且用唱模态、最强语境', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    expect(cand.warmup.length).toBeGreaterThan(0)
    for (const spec of cand.warmup) {
      expect(spec.modality).toBe('sing')
      expect(spec.contextLevel).toBe(0)
    }
  })

  it('热身段产出的题目数足以填满 WARMUP_SECONDS 预算', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    const expectedCount = Math.ceil(WARMUP_SECONDS / ITEM_SECONDS.sing)
    expect(cand.warmup.length).toBe(expectedCount)
    expect(cand.warmup.length * ITEM_SECONDS.sing).toBeGreaterThanOrEqual(WARMUP_SECONDS)
  })

  it('所有候选都是良构规格，且等级不超过当前阶段的要求上限', () => {
    const store = new Map<string, MasteryState>()
    for (const kpId of P1_KPS) {
      for (const m of MODALITIES) {
        store.set(masteryKey(kpId, m), seen({ stability: 5, contextLevel: 4, variationLevel: 6 }))
      }
    }
    const cand = buildCandidates(input(store), makeRng(1))
    for (const list of Object.values(cand)) {
      for (const spec of list) {
        expect(isWellFormedSpec(spec)).toBe(true)
        // P1 的 T 轨最高是 T2：L1 / V1
        if (spec.track === 'T') expect(spec.contextLevel).toBeLessThanOrEqual(1)
      }
    }
  })

  it('同一 seed 产出完全相同的候选', () => {
    const a = buildCandidates(input(new Map()), makeRng(99))
    const b = buildCandidates(input(new Map()), makeRng(99))
    expect(a).toEqual(b)
  })

  it('规格里的 difficultyStep 一律为 0（快机制由会话运行时推进，不落盘）', () => {
    const cand = buildCandidates(input(new Map()), makeRng(1))
    for (const list of Object.values(cand)) {
      for (const spec of list) expect(spec.difficultyStep).toBe(0)
    }
  })
})
