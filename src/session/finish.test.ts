import { describe, expect, it } from 'vitest'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from '../scheduling/mastery'
import { buildSessionPlan } from '../scheduling/scheduler'
import { createSession, reduce } from './machine'
import { SESSION_MINUTES, type ReduceContext, type SessionEffect, type SessionState } from './types'

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

describe('结束流程（P-5 spec §4.1：不再升阶段）', () => {
  it('掌握度全部达标：masteryReady 为真，且不发任何升阶段副作用', () => {
    const r = reduce(emptyPlanSession(), { type: 'start' }, ctx(allP1Strong()))
    expect(r.state.summary?.gate).toEqual({ evaluated: true, masteryReady: true, blockingKeys: 0 })
    expect(r.effects.map((e) => e.type)).not.toContain('advancePhase')
  })

  it('掌握度不足：列出阻塞数', () => {
    const r = reduce(emptyPlanSession(), { type: 'start' }, ctx(new Map()))
    expect(r.state.summary?.gate).toMatchObject({ evaluated: true, masteryReady: false })
    expect(r.state.summary?.gate.blockingKeys).toBe(knowledgePointsOfPhase(c, 'P1').length * 3)
  })

  it('跨天护栏照旧，且关卡评估用拆解后的掌握度', () => {
    const m = allP1Strong()
    const k = masteryKey('degree:major:do', 'recognize')
    m.set(k, {
      ...strong(),
      window: Array.from({ length: 8 }, (_, i) => ({ correct: false, day: 28 + (i % 3), difficultyStep: 3 })),
      lastSeenDay: 30,
    })
    const r = reduce(emptyPlanSession(), { type: 'start' }, ctx(m))
    const saves = find(r.effects, 'saveMastery')
    expect(saves.map((s) => s.key)).toContain(k)
    expect(saves.find((s) => s.key === k)!.state.contextLevel).toBe(0)
    expect(r.state.summary?.gate.masteryReady).toBe(false)
    expect(r.state.summary?.gate.blockingKeys).toBeGreaterThanOrEqual(1)
  })

  it('endEarly：不评估关卡；会话记为完成', () => {
    const r = reduce(emptyPlanSession(), { type: 'endEarly' }, ctx(allP1Strong()))
    expect(r.state.summary?.gate.evaluated).toBe(false)
    expect(find(r.effects, 'saveSession')[0].record.completed).toBe(true)
  })

  it('副作用顺序：saveMastery（护栏）→ saveSession → ended', () => {
    const r = reduce(emptyPlanSession(), { type: 'start' }, ctx(allP1Strong()))
    expect(r.effects.map((e) => e.type).filter((t) => t !== 'saveMastery')).toEqual(['saveSession', 'ended'])
  })

  it('重练模式：只发 ended', () => {
    const d = createSession({ mode: 'drill', day: 30, sessionNo: 0, phaseId: 'P1', plan: { day: 30, seed: 1, phaseId: 'P1', items: [] } })
    const r = reduce(d, { type: 'start' }, ctx(allP1Strong()))
    expect(r.effects.map((e) => e.type)).toEqual(['ended'])
  })

  it('答题中 endEarly：先 stopAudio，会话记录为完成', () => {
    const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 0, seed: 11, minutes: SESSION_MINUTES })
    const x = ctx(new Map())
    let st = reduce(createSession({ mode: 'session', day: 0, sessionNo: 0, phaseId: 'P1', plan }), { type: 'start' }, x).state
    st = reduce(st, { type: 'contentPlayed' }, x).state
    expect(st.phase).toBe('answering')
    const r = reduce(st, { type: 'endEarly' }, x)
    expect(r.effects[0]).toEqual({ type: 'stopAudio' })
    expect(find(r.effects, 'saveSession')[0].record.completed).toBe(true)
    expect(r.state.summary?.gate.evaluated).toBe(false)
  })
})
