import { describe, expect, it } from 'vitest'
import { makeRng } from './rng'

describe('makeRng', () => {
  it('同一 seed 产生完全相同的序列', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('不同 seed 产生不同的序列', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('next() 落在 [0, 1) 区间内', () => {
    const rng = makeRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int(n) 落在 [0, n) 且能取到全部取值', () => {
    const rng = makeRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(5)
      seen.add(v)
    }
    expect(seen.size).toBe(5)
  })

  it('pick 从数组中取元素', () => {
    const rng = makeRng(42)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items))
    }
  })

  it('解构出来的方法仍然工作（不依赖 this）', () => {
    const { int } = makeRng(3)
    expect(() => int(4)).not.toThrow()
  })
})
