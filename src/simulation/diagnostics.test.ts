import { describe, expect, it } from 'vitest'
import {
  accuracyByStep,
  formatGateBreakdown,
  gateBreakdown,
  keyTrajectory,
} from './diagnostics'
import { runSimulation, type AttemptTrace } from './runSimulation'
import { AVERAGE_LEARNER } from './virtualLearner'
import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../curriculum/knowledgePoints'
import { meanLadderStep } from '../scheduling/gating'
import { getMastery } from '../scheduling/mastery'

const c = buildCurriculum()
const traces: AttemptTrace[] = []
const run = runSimulation({
  learner: AVERAGE_LEARNER,
  days: 40,
  minutesPerDay: 25,
  seed: 4242,
  trace: (t) => traces.push(t),
})

describe('gateBreakdown：关卡阻塞分解', () => {
  const b = gateBreakdown(c, run.finalStore, run.finalPhase)

  it('四类计数之和等于该阶段的 key 总数', () => {
    expect(b.total).toBe(knowledgePointsOfPhase(c, run.finalPhase).length * MODALITIES.length)
    expect(b.passing + b.stabilityOnly + b.meanStepOnly + b.both).toBe(b.total)
  })

  it('rows 只含被阻塞的 key，且每行的标记与阈值一致', () => {
    const phase = c.phases.find((p) => p.id === run.finalPhase)!
    expect(b.rows.length).toBe(b.stabilityOnly + b.meanStepOnly + b.both)
    for (const row of b.rows) {
      expect(row.blockedByStability || row.blockedByMeanStep).toBe(true)
      expect(row.blockedByStability).toBe(row.stability < phase.gate.stabilityThreshold)
      expect(row.blockedByMeanStep).toBe(row.meanStep < phase.gate.meanStepThreshold)
      const state = getMastery(run.finalStore, row.key)
      expect(row.stability).toBe(state.stability)
      expect(row.meanStep).toBe(meanLadderStep(state.window))
    }
  })

  it('空 store 上该阶段全部 key 两项判据都卡', () => {
    const empty = gateBreakdown(c, new Map(), 'P1')
    expect(empty.passing).toBe(0)
    expect(empty.both).toBe(empty.total)
    expect(empty.rows.length).toBe(empty.total)
    expect(empty.bossSatisfied).toBe(true)
  })

  it('bossPassed=false 时 bossSatisfied 为 false（P1 要求实战关）', () => {
    expect(gateBreakdown(c, new Map(), 'P1', false).bossSatisfied).toBe(false)
  })

  it('formatGateBreakdown 产出含阶段与计数的可读文本', () => {
    const text = formatGateBreakdown(b)
    expect(text).toContain(run.finalPhase)
    expect(text).toContain(`${b.total}`)
    expect(text.split('\n').length).toBeGreaterThanOrEqual(1 + b.rows.length)
  })
})

describe('accuracyByStep：阶梯分档正确率', () => {
  const rows = accuracyByStep(traces)

  it('按档位升序，且覆盖全部尝试', () => {
    const steps = rows.map((r) => r.step)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(rows.reduce((s, r) => s + r.attempts, 0)).toBe(traces.length)
  })

  it('手工构造的轨迹按档位分组后计数、正确率、均值概率都对', () => {
    const mk = (stepBefore: number, correct: boolean, probability: number): AttemptTrace =>
      ({ ...traces[0], stepBefore, correct, probability })
    const rowsFromFixture = accuracyByStep([
      mk(2, true, 0.25),
      mk(0, false, 0.4),
      mk(2, false, 0.5),
      mk(0, true, 0.6),
      mk(2, true, 0.75),
    ])
    expect(rowsFromFixture).toEqual([
      { step: 0, attempts: 2, correct: 1, accuracy: 0.5, meanProbability: 0.5 },
      { step: 2, attempts: 3, correct: 2, accuracy: 2 / 3, meanProbability: 0.5 },
    ])
  })
})

describe('keyTrajectory：逐 key 轨迹', () => {
  const key = masteryKey('degree:major:do', 'recognize')
  const points = keyTrajectory(traces, key)

  it('只含该 key 的尝试，按天不减', () => {
    expect(points.length).toBe(traces.filter((t) => masteryKey(t.spec.kpId, t.spec.modality) === key).length)
    expect(points.length).toBeGreaterThan(0)
    for (let i = 1; i < points.length; i++) {
      expect(points[i].day).toBeGreaterThanOrEqual(points[i - 1].day)
    }
  })

  it('每个点的 stability 与等级来自写回后的状态', () => {
    const own = traces.filter((t) => masteryKey(t.spec.kpId, t.spec.modality) === key)
    for (let i = 0; i < points.length; i++) {
      expect(points[i].stability).toBe(own[i].stateAfter.stability)
      expect(points[i].contextLevel).toBe(own[i].stateAfter.contextLevel)
      expect(points[i].variationLevel).toBe(own[i].stateAfter.variationLevel)
      expect(points[i].stepBefore).toBe(own[i].stepBefore)
    }
  })

  it('未知 key 返回空数组', () => {
    expect(keyTrajectory(traces, masteryKey('degree:major:do', 'notate') + '/nope' as never)).toEqual([])
  })
})
