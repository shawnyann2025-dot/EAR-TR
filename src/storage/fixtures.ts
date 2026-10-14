import { buildCurriculum, knowledgePointsOfPhase } from '../curriculum/curriculum'
import { masteryKey, MODALITIES, type MasteryKey } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { initialMastery, type MasteryState } from '../scheduling/mastery'
import { SCHEMA_VERSION, type ExportBundle } from './types'

/**
 * 真机验收用导出包：该阶段的掌握度全部达标、没有任何作答，可直接导入后进入实战关。
 * 纯函数、内容固定（日期等不取当前时间），便于提交 JSON 并逐字比对。
 */
export function bossReadyBundle(phaseId: PhaseId): ExportBundle {
  const c = buildCurriculum()
  const mastery: [MasteryKey, MasteryState][] = []
  for (const kp of knowledgePointsOfPhase(c, phaseId))
    for (const m of MODALITIES)
      mastery.push([
        masteryKey(kp, m),
        {
          ...initialMastery(),
          stability: 40,
          contextLevel: 1,
          variationLevel: 1,
          window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: i, difficultyStep: 3 })),
          lastSeenDay: 19,
        },
      ])
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: '2026-09-01T00:00:00.000Z',
    profile: {
      id: 'fixture',
      createdAtLocalDate: '2026-09-01',
      phaseId,
      displayScheme: 'solfege',
      placement: { done: true, startPhase: phaseId },
      schemaVersion: SCHEMA_VERSION,
      vocalRange: null,
      singMode: 'self',
    },
    mastery,
    attempts: [],
    attemptAggregates: [],
    sessions: [],
    gates: [],
    bossAttempts: [],
  }
}
