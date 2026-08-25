import { describe, expect, it } from 'vitest'
import {
  buildCurriculum,
  knowledgePointsOfPhase,
  phaseAt,
  phaseIndex,
  phaseOfKnowledgePoint,
  requirementFor,
  stagesUpTo,
  unlockedKnowledgePoints,
} from './curriculum'
import { ALL_KNOWLEDGE_POINTS } from './tracks'
import { ALL_STAGES, PHASE_ORDER } from './stages'

const c = buildCurriculum()

describe('buildCurriculum', () => {
  it('索引覆盖全部知识点与全部级', () => {
    expect(c.knowledgePoints.size).toBe(ALL_KNOWLEDGE_POINTS.length)
    expect(c.stages.size).toBe(ALL_STAGES.length)
    expect(c.phaseOfStage.size).toBe(ALL_STAGES.length)
  })

  it('每次调用返回等价结果（纯函数）', () => {
    const other = buildCurriculum()
    expect([...other.knowledgePoints.keys()].sort()).toEqual(
      [...c.knowledgePoints.keys()].sort(),
    )
  })
})

describe('phaseIndex / phaseAt', () => {
  it('往返一致', () => {
    PHASE_ORDER.forEach((id, i) => {
      expect(phaseIndex(id)).toBe(i)
      expect(phaseAt(i)).toBe(id)
    })
  })
})

describe('stagesUpTo / unlockedKnowledgePoints', () => {
  it('P1 只含 P1 的级', () => {
    expect(new Set(stagesUpTo(c, 'P1').map((s) => s.id))).toEqual(
      new Set(['T1', 'T2', 'H1', 'H2', 'R1', 'R2']),
    )
  })

  it('解锁集合随阶段单调增长', () => {
    let prev = 0
    for (const phase of PHASE_ORDER) {
      const n = unlockedKnowledgePoints(c, phase).length
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  it('走到 P5 时全部知识点都已解锁', () => {
    expect(new Set(unlockedKnowledgePoints(c, 'P5'))).toEqual(
      new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id)),
    )
  })

  it('knowledgePointsOfPhase 只给该阶段新引入的', () => {
    const p1 = new Set(knowledgePointsOfPhase(c, 'P1'))
    const p2 = new Set(knowledgePointsOfPhase(c, 'P2'))
    expect(p1.has('degree:major:do')).toBe(true)
    expect(p2.has('degree:major:do')).toBe(false)
    expect(p2.has('degree:major:fa')).toBe(true)
  })
})

describe('requirementFor', () => {
  it('要求取自该轨道已解锁的最高一级，而非引入该点那一级', () => {
    // do 在 T1 引入（L0），但 P2 解锁了 T4（L3），故此时 do 的要求也是 L3
    expect(requirementFor(c, 'degree:major:do', 'P1').contextLevel).toBe(1) // T2
    expect(requirementFor(c, 'degree:major:do', 'P2').contextLevel).toBe(3) // T4
  })

  it('要求随阶段单调不减', () => {
    for (const kpId of unlockedKnowledgePoints(c, 'P1')) {
      let prevCtx = -1
      let prevVar = -1
      for (const phase of PHASE_ORDER) {
        const req = requirementFor(c, kpId, phase)
        expect(req.contextLevel).toBeGreaterThanOrEqual(prevCtx)
        expect(req.variationLevel).toBeGreaterThanOrEqual(prevVar)
        prevCtx = req.contextLevel
        prevVar = req.variationLevel
      }
    }
  })

  it('未知知识点抛错', () => {
    expect(() => requirementFor(c, 'degree:nope', 'P1')).toThrow()
  })
})

describe('phaseOfKnowledgePoint', () => {
  it('返回引入该知识点的那个阶段', () => {
    expect(phaseOfKnowledgePoint(c, 'degree:major:do')).toBe('P1')
    expect(phaseOfKnowledgePoint(c, 'degree:minor:la')).toBe('P3')
    expect(phaseOfKnowledgePoint(c, 'chord:V-of-V')).toBe('P5')
  })
})
