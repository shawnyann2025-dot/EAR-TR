import { describe, expect, it } from 'vitest'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from '../scheduling/mastery'
import { bossPassed, createSession, reduce } from './machine'
import type { ReduceContext, SessionEffect, SessionState } from './types'

const c = buildCurriculum()
const ctx = (mastery: Map<string, MasteryState>): ReduceContext => ({ curriculum: c, mastery, nowIso: 'x' })
const emptyPlanSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  ...createSession({ mode: 'session', day: 30, sessionNo: 0, phaseId: 'P1', plan: { day: 30, seed: 1, phaseId: 'P1', items: [] } }),
  ...overrides,
})
const strong = (): MasteryState => ({
  ...initialMastery(),
  stability: 20,
  contextLevel: 1,
  variationLevel: 1,
  window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: 10 + i, difficultyStep: 3 })),
  lastSeenDay: 29,
})
const allP1Strong = () => {
  const m = new Map<string, MasteryState>()
  for (const kp of knowledgePointsOfPhase(c, 'P1')) for (const mod of MODALITIES) m.set(masteryKey(kp, mod), strong())
  return m
}
const find = <T extends SessionEffect['type']>(effects: SessionEffect[], type: T) =>
  effects.filter((e): e is Extract<SessionEffect, { type: T }> => e.type === type)

describe('bossPassed（P-3 spec D3）', () => {
  it('至少答过 1 题且正确率 ≥ 0.8', () => {
    expect(bossPassed({ attempted: 0, correct: 0 })).toBe(false)
    expect(bossPassed({ attempted: 5, correct: 4 })).toBe(true)
    expect(bossPassed({ attempted: 5, correct: 3 })).toBe(false)
  })
})

describe('结束流程', () => {
  it('掌握度全部达标 + 实战关替身通过：发 advancePhase P1 → P2，总结记录升阶段', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([{ type: 'advancePhase', from: 'P1', to: 'P2', day: 30 }])
    expect(r.state.summary?.gate).toMatchObject({ evaluated: true, passed: true, blockingKeys: 0, bossSatisfied: true, advancedTo: 'P2' })
  })

  it('实战关替身未通过：不升阶段', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 3 } }), { type: 'start' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([])
    expect(r.state.summary?.gate).toMatchObject({ evaluated: true, passed: false, bossSatisfied: false })
  })

  it('掌握度不足：列出阻塞的 key 数', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(new Map()))
    expect(r.state.summary?.gate.blockingKeys).toBe(knowledgePointsOfPhase(c, 'P1').length * 3)
  })

  it('跨天护栏：停滞的 key 发 saveMastery（拆解后的状态），并且关卡评估用的是拆解后的状态', () => {
    const m = allP1Strong()
    const k = masteryKey('degree:major:do', 'recognize')
    m.set(k, {
      ...strong(),
      window: Array.from({ length: 8 }, (_, i) => ({ correct: false, day: 28 + (i % 3), difficultyStep: 3 })),
      lastSeenDay: 30,
    })
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(m))
    const saves = find(r.effects, 'saveMastery')
    expect(saves.map((s) => s.key)).toContain(k)
    expect(saves.find((s) => s.key === k)!.state.contextLevel).toBe(0)
  })

  it('endEarly：做护栏与总结，不评估关卡、不升阶段；会话记为完成', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 }, index: 0, plan: { day: 30, seed: 1, phaseId: 'P1', items: [] } }), { type: 'endEarly' }, ctx(allP1Strong()))
    expect(find(r.effects, 'advancePhase')).toEqual([])
    expect(r.state.summary?.gate.evaluated).toBe(false)
    expect(find(r.effects, 'saveSession')[0].record.completed).toBe(true)
  })

  it('最后一阶段过关：不发 advancePhase', () => {
    const s = emptyPlanSession({ phaseId: 'P5', boss: { attempted: 5, correct: 5 }, plan: { day: 30, seed: 1, phaseId: 'P5', items: [] } })
    const m = new Map<string, MasteryState>()
    for (const kp of knowledgePointsOfPhase(c, 'P5')) for (const mod of MODALITIES) m.set(masteryKey(kp, mod), { ...strong(), stability: 40 })
    const r = reduce(s, { type: 'start' }, ctx(m))
    expect(find(r.effects, 'advancePhase')).toEqual([])
  })

  it('副作用顺序：saveMastery（护栏）→ advancePhase → saveSession → ended', () => {
    const r = reduce(emptyPlanSession({ boss: { attempted: 5, correct: 5 } }), { type: 'start' }, ctx(allP1Strong()))
    const order = r.effects.map((e) => e.type).filter((t) => t !== 'saveMastery')
    expect(order).toEqual(['advancePhase', 'saveSession', 'ended'])
  })
})
