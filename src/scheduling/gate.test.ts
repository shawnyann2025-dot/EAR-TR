import { describe, expect, it } from 'vitest'
import { evaluateGate, nextPhase } from './gate'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery, type MasteryState } from './mastery'
import { ALL_PHASES } from '../curriculum/stages'

const c = buildCurriculum()
const P1_GATE = ALL_PHASES[0].gate

function mastered(): MasteryState {
  return {
    ...initialMastery(),
    stability: P1_GATE.stabilityThreshold * 2,
    lastSeenDay: 0,
    window: Array.from({ length: 20 }, (_, i) => ({
      correct: true,
      day: i,
      difficultyStep: P1_GATE.meanStepThreshold + 1,
    })),
  }
}

function storeWith(over: Record<string, MasteryState> = {}) {
  const store = new Map<string, MasteryState>()
  for (const kpId of knowledgePointsOfPhase(c, 'P1')) {
    for (const m of MODALITIES) store.set(masteryKey(kpId, m), mastered())
  }
  for (const [k, v] of Object.entries(over)) store.set(k, v)
  return store
}

describe('evaluateGate', () => {
  it('三模态齐平且实战关通过时过关', () => {
    const result = evaluateGate(c, storeWith(), 'P1', true)
    expect(result.passed).toBe(true)
    expect(result.blockingKeys).toEqual([])
    expect(result.bossSatisfied).toBe(true)
  })

  it('实战关未过则不过关，无逃生口', () => {
    const result = evaluateGate(c, storeWith(), 'P1', false)
    expect(result.passed).toBe(false)
    expect(result.bossSatisfied).toBe(false)
  })

  it('听辨刷满但唱不出来时不过关，且指出是哪个 key 卡住', () => {
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const singKey = masteryKey(kpId, 'sing')
    const result = evaluateGate(c, storeWith({ [singKey]: initialMastery() }), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys).toContain(singKey)
  })

  it('stability 达标但平均阶梯档位不足时不过关', () => {
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const key = masteryKey(kpId, 'notate')
    const weak: MasteryState = {
      ...mastered(),
      window: Array.from({ length: 20 }, (_, i) => ({
        correct: true,
        day: i,
        difficultyStep: 0,
      })),
    }
    const result = evaluateGate(c, storeWith({ [key]: weak }), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys).toContain(key)
  })

  it('正确率约 71% 但档位达标时仍能过关（建模决策 4）', () => {
    // 2-down-1-up 的收敛点是 71%——若关卡卡正确率，它将永不可过
    const kpId = knowledgePointsOfPhase(c, 'P1')[0]
    const key = masteryKey(kpId, 'sing')
    const realistic: MasteryState = {
      ...mastered(),
      window: Array.from({ length: 20 }, (_, i) => ({
        correct: i % 7 !== 0,
        day: i,
        difficultyStep: P1_GATE.meanStepThreshold + 1,
      })),
    }
    const result = evaluateGate(c, storeWith({ [key]: realistic }), 'P1', true)
    expect(result.blockingKeys).not.toContain(key)
  })

  it('空的掌握度库下，该阶段每个知识点的三个模态全部卡住', () => {
    const result = evaluateGate(c, new Map(), 'P1', true)
    expect(result.passed).toBe(false)
    expect(result.blockingKeys.length).toBe(
      knowledgePointsOfPhase(c, 'P1').length * MODALITIES.length,
    )
  })
})

describe('nextPhase', () => {
  it('依次推进，P5 之后为 null', () => {
    expect(nextPhase('P1')).toBe('P2')
    expect(nextPhase('P4')).toBe('P5')
    expect(nextPhase('P5')).toBeNull()
  })
})
