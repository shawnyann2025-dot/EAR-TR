export interface Rng {
  /** 返回 [0, 1) 区间内的浮点数 */
  next(): number
  /** 返回 [0, maxExclusive) 区间内的整数 */
  int(maxExclusive: number): number
  /** 从数组中等概率取一个元素 */
  pick<T>(items: readonly T[]): T
}

/**
 * mulberry32。选它是因为实现短、无外部依赖、分布对本用途足够好，
 * 且状态只有一个 32 位整数——便于日后把 RNG 状态一并存进 SessionRecord。
 */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive)

  const pick = <T,>(items: readonly T[]): T => items[int(items.length)]

  return { next, int, pick }
}
