import { describe, expect, it } from 'vitest'
import {
  ITEM_SECONDS,
  SESSION_SEGMENTS,
  describeSpec,
  isWellFormedSpec,
  itemSeconds,
  type ExerciseSpec,
} from './exerciseSpec'
import { MODALITIES } from '../curriculum/knowledgePoints'

const OK: ExerciseSpec = {
  kpId: 'degree:major:mi',
  modality: 'recognize',
  track: 'T',
  contextLevel: 1,
  variationLevel: 2,
  difficultyStep: 0,
  seed: 12345,
  segment: 'focus',
}

describe('ITEM_SECONDS', () => {
  it('三个模态都有时长，且唱与听写长于听辨', () => {
    for (const m of MODALITIES) expect(ITEM_SECONDS[m]).toBeGreaterThan(0)
    expect(ITEM_SECONDS.sing).toBeGreaterThan(ITEM_SECONDS.recognize)
    expect(ITEM_SECONDS.notate).toBeGreaterThan(ITEM_SECONDS.recognize)
  })

  it('itemSeconds 取自模态', () => {
    expect(itemSeconds(OK)).toBe(ITEM_SECONDS.recognize)
    expect(itemSeconds({ ...OK, modality: 'notate' })).toBe(ITEM_SECONDS.notate)
  })
})

describe('SESSION_SEGMENTS', () => {
  it('恰好五个分段', () => {
    expect([...SESSION_SEGMENTS]).toEqual([
      'warmup', 'review', 'focus', 'introduce', 'boss',
    ])
  })
})

describe('isWellFormedSpec', () => {
  it('合法规格通过', () => {
    expect(isWellFormedSpec(OK)).toBe(true)
  })

  it('语境等级越界不通过', () => {
    expect(isWellFormedSpec({ ...OK, contextLevel: 5 as ExerciseSpec['contextLevel'] })).toBe(false)
    expect(isWellFormedSpec({ ...OK, contextLevel: -1 as ExerciseSpec['contextLevel'] })).toBe(false)
  })

  it('变异等级越界不通过', () => {
    expect(isWellFormedSpec({ ...OK, variationLevel: 7 as ExerciseSpec['variationLevel'] })).toBe(false)
  })

  it('难度档为负不通过', () => {
    expect(isWellFormedSpec({ ...OK, difficultyStep: -1 })).toBe(false)
  })

  it('seed 非整数不通过（生成器需要确定性整数种子）', () => {
    expect(isWellFormedSpec({ ...OK, seed: 1.5 })).toBe(false)
  })

  it('kpId 为空不通过', () => {
    expect(isWellFormedSpec({ ...OK, kpId: '' })).toBe(false)
  })

  it('track 与 kpId 的类型不符不通过', () => {
    // degree:* 属 T 轨，标成 H 轨是错的
    expect(isWellFormedSpec({ ...OK, track: 'H' })).toBe(false)
  })

  it('非法 segment 不通过', () => {
    expect(isWellFormedSpec({ ...OK, segment: 'invalid' as ExerciseSpec['segment'] })).toBe(false)
  })

  it('非法 modality 不通过', () => {
    expect(isWellFormedSpec({ ...OK, modality: 'invalid' as ExerciseSpec['modality'] })).toBe(false)
  })

  it('kpId 无法解析时返回 false 而非抛出异常', () => {
    expect(() => isWellFormedSpec({ ...OK, kpId: 'nocolon' })).not.toThrow()
    expect(isWellFormedSpec({ ...OK, kpId: 'nocolon' })).toBe(false)
  })

  it('difficultyStep 为小数不通过', () => {
    expect(isWellFormedSpec({ ...OK, difficultyStep: 0.5 })).toBe(false)
  })

  it('variationLevel 下界（负数）不通过', () => {
    expect(isWellFormedSpec({ ...OK, variationLevel: -1 as ExerciseSpec['variationLevel'] })).toBe(false)
  })
})

describe('describeSpec', () => {
  it('输出含知识点、模态与两个等级，便于仿真失败时定位', () => {
    const s = describeSpec(OK)
    expect(s).toContain('degree:major:mi')
    expect(s).toContain('recognize')
    expect(s).toContain('L1')
    expect(s).toContain('V2')
  })
})
