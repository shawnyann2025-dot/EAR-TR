import { BOSS_PASS_RATIO, SHORT_PART_ALLOWED_WRONG, SHORT_PART_MAX_POSITIONS, type BossChallenge, type BossResponse, type PartId } from './types'

export interface BossGrade {
  parts: Partial<Record<PartId, number>>
  passed: boolean
  marks: { melody: boolean[][]; chords?: boolean[]; rhythm?: boolean[]; meter?: boolean; newTonic?: boolean }
}

const compare = (expected: readonly string[], got: readonly string[] | undefined) => expected.map((e, i) => got?.[i] === e)
const ratio = (marks: boolean[]) => (marks.length === 0 ? 1 : marks.filter(Boolean).length / marks.length)

/** 分部分判定（P-5 spec §3.4）：每部分 ≥ 0.9 才通过 */
export function gradeBoss(ch: BossChallenge, r: BossResponse): BossGrade {
  const a = ch.answer
  const parts: Partial<Record<PartId, number>> = {}
  const marks: BossGrade['marks'] = { melody: a.melody.map((ph, i) => compare(ph, r.melody?.[i])) }
  for (const part of ch.parts) {
    switch (part) {
      case 'melody':
        parts.melody = ratio(marks.melody.flat())
        break
      case 'chords':
        marks.chords = compare(a.chords ?? [], r.chords)
        parts.chords = ratio(marks.chords)
        break
      case 'rhythm':
        marks.rhythm = compare(a.rhythm ?? [], r.rhythm)
        parts.rhythm = ratio(marks.rhythm)
        break
      case 'meter':
        marks.meter = r.meter === a.meter
        parts.meter = marks.meter ? 1 : 0
        break
      case 'newTonic':
        marks.newTonic = r.newTonic === a.newTonic
        parts.newTonic = marks.newTonic ? 1 : 0
        break
    }
  }
  const positions: Record<PartId, number> = {
    melody: marks.melody.flat().length,
    chords: marks.chords?.length ?? 0,
    rhythm: marks.rhythm?.length ?? 0,
    meter: 1,
    newTonic: 1,
  }
  const partPassed = (p: PartId): boolean => {
    const r = parts[p] ?? 0
    if (r >= BOSS_PASS_RATIO - 1e-12) return true
    const n = positions[p]
    if (n < 2 || n > SHORT_PART_MAX_POSITIONS) return false
    return Math.round((1 - r) * n) <= SHORT_PART_ALLOWED_WRONG
  }
  const passed = ch.parts.every(partPassed)
  return { parts, passed, marks }
}
