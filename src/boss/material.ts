import { unlockedKnowledgePoints, type Curriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { CHORD_ENTRIES } from '../exercises/data/chords'
import { PATTERNS, type MeterId } from '../exercises/data/rhythms'
import { MAJOR_SCALE_DEGREES, type ScaleDegree } from '../music/key'

export interface BossMaterial {
  melodyDegrees: ScaleDegree[]
  meters: MeterId[]
  progressions: string[][]
  chordIds: string[]
  patternIds: string[]
}

const METER_KP: Partial<Record<MeterId, string>> = {
  '2/4': 'rhythm:meter-2-4',
  '3/4': 'rhythm:meter-3-4',
}

/** 该阶段（含之前阶段）已解锁的素材（P-5 spec §3.3） */
export function bossMaterial(c: Curriculum, phaseId: PhaseId): BossMaterial {
  const unlocked = new Set<string>(unlockedKnowledgePoints(c, phaseId))
  const melodyDegrees = MAJOR_SCALE_DEGREES.filter((d) => unlocked.has(`degree:major:${d}`))
  const meters = (['2/4', '3/4', '4/4'] as MeterId[]).filter((m) => m === '4/4' || unlocked.has(METER_KP[m] ?? ''))
  const progressions: string[][] = []
  const chordIds: string[] = []
  for (const e of CHORD_ENTRIES) {
    if (!unlocked.has(e.kpId) || e.mode !== 'major') continue
    if (e.family === 'progression') progressions.push([...e.chordIds])
    if (e.family === 'functional') chordIds.push(e.answerId)
  }
  const patternIds = PATTERNS.filter((p) => p.bars === 1 && p.targetable !== false && unlocked.has(p.ownerKpId)).map((p) => p.id)
  return { melodyDegrees: [...melodyDegrees], meters, progressions, chordIds, patternIds }
}
