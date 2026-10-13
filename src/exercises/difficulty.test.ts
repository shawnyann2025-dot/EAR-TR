import { describe, expect, it } from 'vitest'
import {
  BASE_BPM,
  DIFFICULTY_TABLE,
  SING_CENTS_TOLERANCE,
  SLOW_FACTOR,
  clampDifficultyStep,
  difficultyParams,
} from './difficulty'
import type { Exercise } from './types'

describe('DIFFICULTY_TABLE（P-2b spec §6）', () => {
  it('每一行恰好 6 档', () => {
    for (const row of Object.values(DIFFICULTY_TABLE)) {
      expect(row).toHaveLength(6)
    }
  })

  it('数值与 spec 表一致', () => {
    expect(DIFFICULTY_TABLE.recognizeOptionCount).toEqual([2, 3, 4, 5, 6, Infinity])
    expect(DIFFICULTY_TABLE.recognizeNoteSec).toEqual([1.0, 0.9, 0.8, 0.7, 0.6, 0.5])
    expect(DIFFICULTY_TABLE.notateMelodyLength).toEqual([3, 4, 5, 6, 7, 8])
    expect(DIFFICULTY_TABLE.notateChordCount).toEqual([2, 3, 3, 4, 4, 5])
    expect(DIFFICULTY_TABLE.notateRhythmBars).toEqual([1, 1, 2, 2, 2, 4])
    expect(DIFFICULTY_TABLE.singTargetCount).toEqual([1, 1, 2, 2, 3, 3])
    expect(DIFFICULTY_TABLE.tapToleranceSec).toEqual([0.12, 0.11, 0.1, 0.08, 0.07, 0.06])
    expect(DIFFICULTY_TABLE.tapBars).toEqual([1, 1, 1, 2, 2, 2])
  })

  it('越难越难：选项不减、时长不增、长度不减、容差不增', () => {
    const nonDecreasing = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1])
    const nonIncreasing = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x <= xs[i - 1])
    expect(nonDecreasing(DIFFICULTY_TABLE.recognizeOptionCount)).toBe(true)
    expect(nonIncreasing(DIFFICULTY_TABLE.recognizeNoteSec)).toBe(true)
    expect(nonDecreasing(DIFFICULTY_TABLE.notateMelodyLength)).toBe(true)
    expect(nonDecreasing(DIFFICULTY_TABLE.singTargetCount)).toBe(true)
    expect(nonIncreasing(DIFFICULTY_TABLE.tapToleranceSec)).toBe(true)
  })
})

describe('clampDifficultyStep / difficultyParams', () => {
  it('越界档位钳到 0–5，小数四舍五入', () => {
    expect(clampDifficultyStep(-3)).toBe(0)
    expect(clampDifficultyStep(9)).toBe(5)
    expect(clampDifficultyStep(2.4)).toBe(2)
    expect(clampDifficultyStep(2.6)).toBe(3)
  })

  it('按档位取出同一列', () => {
    const p = difficultyParams(3)
    expect(p.recognizeOptionCount).toBe(5)
    expect(p.notateMelodyLength).toBe(6)
    expect(p.singTargetCount).toBe(2)
    expect(p.tapToleranceSec).toBe(0.08)
  })

  it('越界档位与钳制后的档位取值相同', () => {
    expect(difficultyParams(42)).toEqual(difficultyParams(5))
    expect(difficultyParams(-1)).toEqual(difficultyParams(0))
  })
})

describe('常量', () => {
  it('与 spec 一致', () => {
    expect(SING_CENTS_TOLERANCE).toBe(50)
    expect(SLOW_FACTOR).toBe(0.6)
    expect(BASE_BPM).toBe(90)
  })

  it('types.ts 可被编译期引用', () => {
    const shape: Pick<Exercise, 'prompt'> = { prompt: 'which-degree' }
    expect(shape.prompt).toBe('which-degree')
  })
})
