import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId } from '../curriculum/knowledgePoints'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { sessionSeed } from '../session/time'

/** 分级测试用的「日」：负数，保证与练习日的 seed 不重叠 */
export const PLACEMENT_DAY = -1

/** 分级探针：识别模态、最强语境、无变异、最低档（P-3 spec §6.1） */
export function probeSpec(c: Curriculum, kpId: KnowledgePointId, seed: number): ExerciseSpec {
  const kp = c.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  return { kpId, modality: 'recognize', track: kp.track, contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed, segment: 'focus' }
}

export function probeSeed(profileId: string, probeIndex: number): number {
  return sessionSeed(profileId, PLACEMENT_DAY, probeIndex)
}
