import { describe, expect, it } from 'vitest'
import { runSimulation, type SimulationResult } from './runSimulation'
import { AVERAGE_LEARNER, SLOW_LEARNER } from './virtualLearner'

/**
 * 特征快照：P-3a 把逐题逻辑搬到 session/item.ts，仿真改为复用。
 * 这份快照在搬迁之前写出，搬迁后必须逐字一致——它守的是「搬家不改行为」。
 */
function fingerprint(r: SimulationResult) {
  return {
    finalPhase: r.finalPhase,
    phaseCompletionDay: r.phaseCompletionDay,
    ladderAccuracy: r.ladderAccuracy.toFixed(9),
    days: r.days.map((d) => [d.phaseId, d.itemCount, d.correct, d.reliefTriggered ? 1 : 0, d.decomposedKeys.join(',')]),
    store: [...r.finalStore.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, s]) => [k, s.stability.toFixed(9), s.difficulty.toFixed(9), s.variationLevel, s.contextLevel, s.window.length]),
  }
}

describe('仿真特征快照（搬迁守卫）', () => {
  it('普通学习者 180 天', () => {
    expect(fingerprint(runSimulation({ learner: AVERAGE_LEARNER, days: 180, minutesPerDay: 25, seed: 4242 }))).toMatchSnapshot()
  })
  it('慢学习者 180 天', () => {
    expect(fingerprint(runSimulation({ learner: SLOW_LEARNER, days: 180, minutesPerDay: 25, seed: 4242 }))).toMatchSnapshot()
  })
})
