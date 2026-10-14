import { trackOfKind, type KnowledgePointId } from '../curriculum/knowledgePoints'
import { CHORD_ENTRIES } from '../exercises/data/chords'
import { PATTERNS } from '../exercises/data/rhythms'
import type { Rng } from '../music/rng'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import type { VirtualLearner } from '../simulation/virtualLearner'
import type { BossChallenge, BossResponse } from './types'

/** 虚拟学习者作答实战关时，每个位置按这个难度的听写题计概率 */
export const BOSS_SPEC_LEVEL = { contextLevel: 1, variationLevel: 1, difficultyStep: 1 } as const

const METER_KP: Record<string, KnowledgePointId> = {
  '2/4': 'rhythm:meter-2-4',
  '3/4': 'rhythm:meter-3-4',
  '4/4': 'rhythm:beat-one',
}

const chordKp = (id: string): KnowledgePointId => {
  const e = CHORD_ENTRIES.find((x) => x.family === 'functional' && x.mode === 'major' && x.answerId === id)
  if (!e) throw new Error(`没有和弦 ${id} 的知识点`)
  return e.kpId
}
const patternKp = (id: string): KnowledgePointId => {
  const p = PATTERNS.find((x) => x.id === id)
  if (!p) throw new Error(`没有音型 ${id}`)
  return p.ownerKpId
}

export function positionKpIds(ch: BossChallenge) {
  const a = ch.answer
  return {
    melody: a.melody.map((ph) => ph.map((d) => `degree:major:${d}`)),
    ...(a.chords ? { chords: a.chords.map(chordKp) } : {}),
    ...(a.rhythm ? { rhythm: a.rhythm.map(patternKp) } : {}),
    ...(a.meter ? { meter: METER_KP[a.meter] } : {}),
    ...(a.newTonic ? { newTonic: 'degree:modulation:shift' } : {}),
  }
}

const kindOf = (kpId: KnowledgePointId) => kpId.slice(0, kpId.indexOf(':')) as Parameters<typeof trackOfKind>[0]

export function simulateBossAttempt(ch: BossChallenge, learner: Pick<VirtualLearner, 'probabilityOf'>, rng: Rng): BossResponse {
  const ids = positionKpIds(ch)
  const answerOne = (kpId: KnowledgePointId, correct: string, alphabet: readonly string[]): string => {
    const spec: ExerciseSpec = { kpId, modality: 'notate', track: trackOfKind(kindOf(kpId)), ...BOSS_SPEC_LEVEL, seed: 0, segment: 'boss' }
    if (rng.next() < learner.probabilityOf(spec, BOSS_SPEC_LEVEL.difficultyStep)) return correct
    const wrong = alphabet.filter((x) => x !== correct)
    return wrong.length > 0 ? rng.pick(wrong) : correct
  }
  const a = ch.answer
  return {
    melody: a.melody.map((ph, i) => ph.map((d, j) => answerOne(ids.melody[i][j], d, ch.alphabets.melody))),
    ...(a.chords ? { chords: a.chords.map((x, i) => answerOne(ids.chords![i], x, ch.alphabets.chords ?? [])) } : {}),
    ...(a.rhythm ? { rhythm: a.rhythm.map((x, i) => answerOne(ids.rhythm![i], x, ch.alphabets.rhythm ?? [])) } : {}),
    ...(a.meter ? { meter: answerOne(ids.meter!, a.meter, ch.alphabets.meter ?? []) } : {}),
    ...(a.newTonic ? { newTonic: answerOne(ids.newTonic!, a.newTonic, ch.alphabets.newTonic ?? []) } : {}),
  }
}
