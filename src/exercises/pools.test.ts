import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { makeRng } from '../music/rng'
import { degreeEntry } from './data/degrees'
import { pickOptions, poolMembers, shuffle, stageOfKnowledgePoint } from './pools'

const c = buildCurriculum()
const degreePool = (id: string) => degreeEntry(id)?.pool
const names = (ids: string[]) => ids.map((id) => id.replace('degree:', '')).sort()

describe('stageOfKnowledgePoint', () => {
  it('返回引入该知识点的级', () => {
    expect(stageOfKnowledgePoint('degree:major:re').id).toBe('T2')
    expect(stageOfKnowledgePoint('degree:minor:si').id).toBe('T6')
  })

  it('未被引入的知识点抛错', () => {
    expect(() => stageOfKnowledgePoint('degree:major:nope')).toThrow(/degree:major:nope/)
  })
})

describe('poolMembers：干扰池由课程静态推导（P-2b spec D2）', () => {
  it('T1 的 do：只有 T1 的三个骨架音', () => {
    expect(names(poolMembers(c, 'degree:major:do', degreePool))).toEqual(
      ['major:do', 'major:mi', 'major:sol'],
    )
  })

  it('T2 的 re：T1 + T2，不含后面才学的 fa ti', () => {
    expect(names(poolMembers(c, 'degree:major:re', degreePool))).toEqual(
      ['major:do', 'major:la', 'major:mi', 'major:re', 'major:sol'],
    )
  })

  it('T7 的 fi：大调全部，不含小调', () => {
    const pool = names(poolMembers(c, 'degree:major:fi', degreePool))
    expect(pool).toHaveLength(10)
    expect(pool.every((n) => n.startsWith('major:'))).toBe(true)
  })

  it('T6 的 si：小调全部 9 个（同级的 fi 也在）', () => {
    expect(poolMembers(c, 'degree:minor:si', degreePool)).toHaveLength(9)
  })

  it('按课程顺序排列，含目标本身', () => {
    const pool = poolMembers(c, 'degree:major:ti', degreePool)
    expect(pool).toContain('degree:major:ti')
    expect(pool.slice(0, 3).sort()).toEqual(['degree:major:do', 'degree:major:mi', 'degree:major:sol'])
  })

  it('目标不属于任何池时抛错', () => {
    expect(() => poolMembers(c, 'chord:I', degreePool)).toThrow(/chord:I/)
  })
})

describe('shuffle', () => {
  it('是原数组的一个排列，且不修改输入', () => {
    const xs = [1, 2, 3, 4, 5, 6]
    const out = shuffle(xs, makeRng(3))
    expect([...out].sort()).toEqual(xs)
    expect(xs).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('不同 seed 至少产生两种排列', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, s) => shuffle([1, 2, 3, 4], makeRng(s + 1)).join()),
    )
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('pickOptions', () => {
  const pool = ['do', 'mi', 'sol', 're', 'la']

  it('含目标、去重、个数正确', () => {
    for (let s = 1; s <= 30; s++) {
      const opts = pickOptions('re', pool, 3, makeRng(s))
      expect(opts).toHaveLength(3)
      expect(opts).toContain('re')
      expect(new Set(opts).size).toBe(3)
      expect(opts.every((o) => pool.includes(o))).toBe(true)
    }
  })

  it('个数少于 2 时按 2 算；超过池大小时取全部', () => {
    expect(pickOptions('re', pool, 1, makeRng(1))).toHaveLength(2)
    expect(pickOptions('re', pool, Infinity, makeRng(1)).sort()).toEqual([...pool].sort())
  })

  it('候选里有重复或不含目标时仍正确', () => {
    const opts = pickOptions('ti', ['do', 'do', 'mi'], 10, makeRng(1))
    expect(opts.sort()).toEqual(['do', 'mi', 'ti'])
  })

  it('目标不总在第一位', () => {
    const firsts = new Set(
      Array.from({ length: 30 }, (_, s) => pickOptions('re', pool, 4, makeRng(s + 1))[0]),
    )
    expect(firsts.size).toBeGreaterThan(1)
  })

  it('确定性', () => {
    expect(pickOptions('re', pool, 4, makeRng(8))).toEqual(pickOptions('re', pool, 4, makeRng(8)))
  })
})
