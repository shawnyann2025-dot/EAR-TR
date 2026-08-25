import { describe, expect, it } from 'vitest'
import {
  AVERAGE_LEARNER,
  FAST_LEARNER,
  SLOW_LEARNER,
  demandOf,
  makeVirtualLearner,
} from './virtualLearner'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { masteryKey } from '../curriculum/knowledgePoints'

const EASY: ExerciseSpec = {
  kpId: 'degree:major:do', modality: 'recognize', track: 'T',
  contextLevel: 0, variationLevel: 0, difficultyStep: 0,
  seed: 1, segment: 'focus',
}
const HARD: ExerciseSpec = {
  ...EASY, contextLevel: 4, variationLevel: 6, difficultyStep: 5, modality: 'notate',
}

describe('demandOf', () => {
  it('难题的要求高于易题', () => {
    expect(demandOf(HARD, 5)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('语境等级、变异等级、难度档各自单调增加要求', () => {
    expect(demandOf({ ...EASY, contextLevel: 2 }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf({ ...EASY, variationLevel: 3 }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf(EASY, 3)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('唱与听写的要求高于听辨', () => {
    expect(demandOf({ ...EASY, modality: 'sing' }, 0)).toBeGreaterThan(demandOf(EASY, 0))
    expect(demandOf({ ...EASY, modality: 'notate' }, 0)).toBeGreaterThan(demandOf(EASY, 0))
  })

  it('要求落在 0–1', () => {
    for (const spec of [EASY, HARD]) {
      for (const step of [0, 5]) {
        expect(demandOf(spec, step)).toBeGreaterThanOrEqual(0)
        expect(demandOf(spec, step)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('makeVirtualLearner', () => {
  it('作答概率落在猜对率与 1 之间', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    for (const spec of [EASY, HARD]) {
      const p = l.probabilityOf(spec, 0)
      expect(p).toBeGreaterThanOrEqual(AVERAGE_LEARNER.guessRate)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('易题的作答概率高于难题', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    expect(l.probabilityOf(EASY, 0)).toBeGreaterThan(l.probabilityOf(HARD, 5))
  })

  it('会学习：反复作答后同一题的正确概率上升', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    const before = l.probabilityOf(EASY, 0)
    for (let i = 0; i < 60; i++) l.answer(EASY, 0)
    expect(l.probabilityOf(EASY, 0)).toBeGreaterThan(before)
  })

  it('学习是按 (知识点, 模态) 分开的，练听辨不会让唱变强', () => {
    const l = makeVirtualLearner(AVERAGE_LEARNER)
    const singKey = masteryKey(EASY.kpId, 'sing')
    const before = l.abilityOf(singKey)
    for (let i = 0; i < 60; i++) l.answer(EASY, 0)
    expect(l.abilityOf(singKey)).toBeCloseTo(before, 10)
  })

  it('能力不超过 1', () => {
    const l = makeVirtualLearner({ ...AVERAGE_LEARNER, learningRate: 0.9 })
    for (let i = 0; i < 500; i++) l.answer(EASY, 0)
    expect(l.abilityOf(masteryKey(EASY.kpId, 'recognize'))).toBeLessThanOrEqual(1)
  })

  it('同一 seed 产出完全相同的作答序列', () => {
    const a = makeVirtualLearner(AVERAGE_LEARNER)
    const b = makeVirtualLearner(AVERAGE_LEARNER)
    const seqA = Array.from({ length: 50 }, () => a.answer(HARD, 2))
    const seqB = Array.from({ length: 50 }, () => b.answer(HARD, 2))
    expect(seqA).toEqual(seqB)
  })

  it('快学习者比慢学习者学得快', () => {
    const fast = makeVirtualLearner(FAST_LEARNER)
    const slow = makeVirtualLearner(SLOW_LEARNER)
    for (let i = 0; i < 40; i++) {
      fast.answer(EASY, 0)
      slow.answer(EASY, 0)
    }
    const key = masteryKey(EASY.kpId, 'recognize')
    expect(fast.abilityOf(key)).toBeGreaterThan(slow.abilityOf(key))
  })

  it('三份预设的参数都合法', () => {
    for (const p of [AVERAGE_LEARNER, FAST_LEARNER, SLOW_LEARNER]) {
      expect(p.guessRate).toBeGreaterThanOrEqual(0)
      expect(p.guessRate).toBeLessThan(1)
      expect(p.learningRate).toBeGreaterThan(0)
      expect(p.learningRate).toBeGreaterThan(p.errorLearningRate)
    }
  })
})
