import { BOSS_PASS_RATIO, type BossChallenge, type BossResponse, type PartId } from './types'

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
  const passed = ch.parts.every((p) => (parts[p] ?? 0) >= BOSS_PASS_RATIO - 1e-12)
  return { parts, passed, marks }
}
