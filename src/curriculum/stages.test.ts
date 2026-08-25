import { describe, expect, it } from 'vitest'
import { ALL_PHASES, ALL_STAGES, PHASE_ORDER } from './stages'
import { ALL_KNOWLEDGE_POINTS } from './tracks'

const stageById = new Map(ALL_STAGES.map((s) => [s.id, s]))

describe('ALL_STAGES', () => {
  it('id 互不重复，且三轨各八级共 24 级', () => {
    const ids = ALL_STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(24)
  })

  it('id 形如 T1..T8 / H1..H8 / R1..R8，且与 track 字段一致', () => {
    for (const stage of ALL_STAGES) {
      expect(stage.id).toMatch(/^[THR][1-8]$/)
      expect(stage.id[0]).toBe(stage.track)
    }
  })

  it('引入的知识点全部存在，且每个知识点恰好被引入一次', () => {
    const known = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    const introduced: string[] = []
    for (const stage of ALL_STAGES) {
      for (const id of stage.introduces) {
        expect(known.has(id)).toBe(true)
        introduced.push(id)
      }
    }
    expect(new Set(introduced).size).toBe(introduced.length)
    // 无孤立知识点：每个都被某一级引入
    expect(new Set(introduced).size).toBe(known.size)
  })

  it('引入的知识点其 track 必须等于所在级的 track', () => {
    const trackOf = new Map(ALL_KNOWLEDGE_POINTS.map((kp) => [kp.id, kp.track]))
    for (const stage of ALL_STAGES) {
      for (const id of stage.introduces) {
        expect(trackOf.get(id)).toBe(stage.track)
      }
    }
  })

  it('前置级存在，且序号严格小于本级（无环、无前向引用）', () => {
    for (const stage of ALL_STAGES) {
      for (const pre of stage.prerequisiteStages) {
        expect(stageById.has(pre)).toBe(true)
        const preStage = stageById.get(pre)!
        expect(preStage.track).toBe(stage.track)
        expect(Number(pre.slice(1))).toBeLessThan(Number(stage.id.slice(1)))
      }
    }
  })

  it('同一轨道内语境与变异要求单调不减', () => {
    for (const track of ['T', 'H', 'R'] as const) {
      const stages = ALL_STAGES.filter((s) => s.track === track).sort(
        (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
      )
      for (let i = 1; i < stages.length; i++) {
        expect(stages[i].requiresContextLevel).toBeGreaterThanOrEqual(
          stages[i - 1].requiresContextLevel,
        )
        expect(stages[i].requiresVariationLevel).toBeGreaterThanOrEqual(
          stages[i - 1].requiresVariationLevel,
        )
      }
    }
  })

  it('T4 不引入新知识点，只提高语境要求（建模决策 1）', () => {
    const t3 = stageById.get('T3')!
    const t4 = stageById.get('T4')!
    expect(t4.introduces).toHaveLength(0)
    expect(t4.requiresContextLevel).toBeGreaterThan(t3.requiresContextLevel)
  })
})

describe('ALL_PHASES', () => {
  it('恰好五个阶段，顺序为 P1..P5', () => {
    expect(ALL_PHASES.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
    expect([...PHASE_ORDER]).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
  })

  it('每一级恰好属于一个阶段，且全部 24 级都被覆盖', () => {
    const assigned = ALL_PHASES.flatMap((p) => p.stages)
    expect(new Set(assigned).size).toBe(assigned.length)
    expect(new Set(assigned)).toEqual(new Set(ALL_STAGES.map((s) => s.id)))
  })

  it('阶段内的级全部存在，且一个级的前置级不得排在更晚的阶段', () => {
    const phaseIndexOfStage = new Map<string, number>()
    ALL_PHASES.forEach((p, i) => p.stages.forEach((s) => phaseIndexOfStage.set(s, i)))
    for (const stage of ALL_STAGES) {
      expect(phaseIndexOfStage.has(stage.id)).toBe(true)
      for (const pre of stage.prerequisiteStages) {
        expect(phaseIndexOfStage.get(pre)!).toBeLessThanOrEqual(
          phaseIndexOfStage.get(stage.id)!,
        )
      }
    }
  })

  it('每个阶段都要求过实战关，且阈值为正（spec §8.3 无逃生口）', () => {
    for (const phase of ALL_PHASES) {
      expect(phase.gate.requiresBoss).toBe(true)
      expect(phase.gate.stabilityThreshold).toBeGreaterThan(0)
      expect(phase.gate.meanStepThreshold).toBeGreaterThan(0)
      // 档位范围是 0–5，阈值必须留出余量，否则关卡不可达
      expect(phase.gate.meanStepThreshold).toBeLessThanOrEqual(4)
    }
  })

  it('关卡阈值随阶段递增', () => {
    for (let i = 1; i < ALL_PHASES.length; i++) {
      expect(ALL_PHASES[i].gate.stabilityThreshold).toBeGreaterThan(
        ALL_PHASES[i - 1].gate.stabilityThreshold,
      )
      expect(ALL_PHASES[i].gate.meanStepThreshold).toBeGreaterThanOrEqual(
        ALL_PHASES[i - 1].gate.meanStepThreshold,
      )
    }
  })

  it('P1 覆盖 T1–T2 / H1–H2 / R1–R2（spec §8.2）', () => {
    const p1 = ALL_PHASES[0]
    expect(new Set(p1.stages)).toEqual(new Set(['T1', 'T2', 'H1', 'H2', 'R1', 'R2']))
  })
})
