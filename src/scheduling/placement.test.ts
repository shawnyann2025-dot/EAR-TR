import { describe, expect, it } from 'vitest'
import {
  PLACEMENT_MAX_PROBES,
  PLACEMENT_STOP_AFTER_FAILURES,
  initialPlacement,
  nextProbe,
  placementProbeOrder,
  placementResult,
  recordProbe,
  type PlacementState,
} from './placement'
import { buildCurriculum, phaseOfKnowledgePoint } from '../curriculum/curriculum'

const c = buildCurriculum()

function runProbes(answers: boolean[]): PlacementState {
  let state = initialPlacement(c)
  for (const correct of answers) {
    if (nextProbe(state) === null) break
    state = recordProbe(state, correct)
  }
  return state
}

describe('placementProbeOrder', () => {
  it('探针数量不超过上限', () => {
    expect(placementProbeOrder(c).length).toBeLessThanOrEqual(PLACEMENT_MAX_PROBES)
  })

  it('探针互不重复，且都是真实知识点', () => {
    const probes = placementProbeOrder(c)
    expect(new Set(probes).size).toBe(probes.length)
    for (const id of probes) expect(c.knowledgePoints.has(id)).toBe(true)
  })

  it('由易到难：所属阶段单调不减', () => {
    const probes = placementProbeOrder(c)
    let prev = -1
    for (const id of probes) {
      const idx = ['P1', 'P2', 'P3', 'P4', 'P5'].indexOf(phaseOfKnowledgePoint(c, id))
      expect(idx).toBeGreaterThanOrEqual(prev)
      prev = idx
    }
  })

  it('第一个探针属于 P1', () => {
    expect(phaseOfKnowledgePoint(c, placementProbeOrder(c)[0])).toBe('P1')
  })
})

describe('nextProbe / recordProbe', () => {
  it('全新状态给出第一个探针', () => {
    expect(nextProbe(initialPlacement(c))).toBe(placementProbeOrder(c)[0])
  })

  it('连续失败达阈值后停止', () => {
    const state = runProbes(Array(PLACEMENT_STOP_AFTER_FAILURES).fill(false))
    expect(nextProbe(state)).toBeNull()
  })

  it('失败被正确打断后不停止', () => {
    const answers: boolean[] = []
    for (let i = 0; i < PLACEMENT_STOP_AFTER_FAILURES - 1; i++) answers.push(false)
    answers.push(true)
    expect(nextProbe(runProbes(answers))).not.toBeNull()
  })

  it('答完全部探针后停止', () => {
    expect(nextProbe(runProbes(Array(PLACEMENT_MAX_PROBES).fill(true)))).toBeNull()
  })

  it('不修改输入状态', () => {
    const s = initialPlacement(c)
    recordProbe(s, true)
    expect(s.results).toEqual([])
  })
})

describe('placementResult', () => {
  it('一题未答对时从 P1 起', () => {
    expect(placementResult(c, runProbes([false, false]))).toBe('P1')
  })

  it('全部答对时给到最后一个探针所属阶段', () => {
    const state = runProbes(Array(PLACEMENT_MAX_PROBES).fill(true))
    const probes = placementProbeOrder(c)
    expect(placementResult(c, state)).toBe(
      phaseOfKnowledgePoint(c, probes[probes.length - 1]),
    )
  })

  it('答对前几题后失败，起点是最后一个答对的探针所属阶段', () => {
    const probes = placementProbeOrder(c)
    const answers = [true, true, ...Array(PLACEMENT_STOP_AFTER_FAILURES).fill(false)]
    expect(placementResult(c, runProbes(answers))).toBe(
      phaseOfKnowledgePoint(c, probes[1]),
    )
  })

  it('空状态返回 P1（未做分级测试的用户从头开始）', () => {
    expect(placementResult(c, initialPlacement(c))).toBe('P1')
  })
})
