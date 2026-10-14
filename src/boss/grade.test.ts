import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generateBoss } from './generate'
import { gradeBoss } from './grade'
import type { BossChallenge, BossResponse } from './types'

const c = buildCurriculum()
const perfect = (ch: BossChallenge): BossResponse => JSON.parse(JSON.stringify(ch.answer))

/** 把旋律的前 k 个音改错 */
function spoilMelody(ch: BossChallenge, k: number): BossResponse {
  const r = perfect(ch)
  let left = k
  for (const ph of r.melody) for (let i = 0; i < ph.length && left > 0; i++, left--) ph[i] = ph[i] === 'do' ? 're' : 'do'
  return r
}

describe('gradeBoss（P-5 spec §3.4）', () => {
  it('完美作答：每部分 1、通过', () => {
    for (const phaseId of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
      const ch = generateBoss(c, phaseId, 9)
      const g = gradeBoss(ch, perfect(ch))
      expect(g.passed).toBe(true)
      for (const p of ch.parts) expect(g.parts[p]).toBe(1)
    }
  })

  it('旋律恰好 90% 通过，低于 90% 不通过', () => {
    const ch = generateBoss(c, 'P2', 3)
    const total = ch.answer.melody.flat().length
    const okWrong = Math.floor(total * 0.1)
    const atNinety = gradeBoss(ch, spoilMelody(ch, okWrong))
    expect(atNinety.parts.melody).toBeGreaterThanOrEqual(0.9)
    expect(atNinety.passed).toBe(true)
    const below = gradeBoss(ch, spoilMelody(ch, okWrong + 1))
    expect(below.parts.melody).toBeLessThan(0.9)
    expect(below.passed).toBe(false)
  })

  it('任一部分不过，整体不过（P1 拍号错）', () => {
    const ch = generateBoss(c, 'P1', 5)
    const r = perfect(ch)
    r.meter = r.meter === '2/4' ? '3/4' : '2/4'
    const g = gradeBoss(ch, r)
    expect(g.parts.melody).toBe(1)
    expect(g.parts.meter).toBe(0)
    expect(g.passed).toBe(false)
  })

  it('缺答记错：少写一句旋律、没选和弦', () => {
    const ch = generateBoss(c, 'P3', 2)
    const r = perfect(ch)
    r.melody[0] = []
    r.chords = r.chords!.slice(0, -1)
    const g = gradeBoss(ch, r)
    expect(g.marks.melody[0].every((x) => !x)).toBe(true)
    expect(g.marks.chords!.at(-1)).toBe(false)
    expect(g.parts.chords).toBeCloseTo(7 / 8)
  })

  it('逐位标记与答案对齐', () => {
    const ch = generateBoss(c, 'P4', 1)
    const g = gradeBoss(ch, perfect(ch))
    expect(g.marks.melody.map((m) => m.length)).toEqual(ch.answer.melody.map((m) => m.length))
    expect(g.marks.rhythm).toHaveLength(ch.piece.bars)
  })
})

describe('短部分宽限（用户裁定 2026-10-14）', () => {
  it('8 小节和弦错 1 个仍通过，错 2 个不通过', () => {
    const ch = generateBoss(c, 'P3', 2)
    const one = perfect(ch)
    one.chords![0] = one.chords![0] === 'I' ? 'IV' : 'I'
    expect(gradeBoss(ch, one).parts.chords).toBeCloseTo(7 / 8)
    expect(gradeBoss(ch, one).passed).toBe(true)
    const two = perfect(ch)
    two.chords![0] = two.chords![0] === 'I' ? 'IV' : 'I'
    two.chords![1] = two.chords![1] === 'I' ? 'IV' : 'I'
    expect(gradeBoss(ch, two).passed).toBe(false)
  })
  it('P4 节奏错 1 个仍通过', () => {
    const ch = generateBoss(c, 'P4', 1)
    const r = perfect(ch)
    r.rhythm![3] = ch.alphabets.rhythm!.find((x) => x !== r.rhythm![3])!
    expect(gradeBoss(ch, r).passed).toBe(true)
  })
  it('单题部分没有宽限：拍号错就不通过', () => {
    const ch = generateBoss(c, 'P1', 5)
    const r = perfect(ch)
    r.meter = ch.alphabets.meter!.find((x) => x !== r.meter)!
    expect(gradeBoss(ch, r).passed).toBe(false)
  })
})
