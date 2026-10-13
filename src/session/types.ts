import type { Curriculum } from '../curriculum/curriculum'
import type { KnowledgePointId, MasteryKey, Modality, Track } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { Exercise, GradeResult, Response } from '../exercises/generate'
import type { PlaybackPlan } from '../music/playback'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import type { SessionProgress } from '../scheduling/guardrails'
import type { LadderState } from '../scheduling/ladder'
import type { MasteryState, MasteryStore } from '../scheduling/mastery'
import type { SessionPlan } from '../scheduling/scheduler'

/** 实战关替身：本场实战关段正确率达标即视为通过（P-3 spec D3） */
export const BOSS_STANDIN_ACCURACY = 0.8
export const SESSION_MINUTES = 25

export type SessionMode = 'session' | 'drill'
export type SessionPhase = 'idle' | 'presenting' | 'answering' | 'feedback' | 'done'

export interface Tally {
  attempted: number
  correct: number
}

export interface CurrentItem {
  planIndex: number
  /** 实时规格（含档位、回血后的难度） */
  spec: ExerciseSpec
  exercise: Exercise
  /** 计分题才更新阶梯、计数、掌握度与作答记录 */
  scored: boolean
  /** 计分题出题时的阶梯；非计分题为 null */
  ladder: LadderState | null
}

export interface SessionSummary {
  scored: number
  correct: number
  accuracy: number
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  gate: {
    evaluated: boolean
    passed: boolean
    blockingKeys: number
    bossSatisfied: boolean
    advancedTo: PhaseId | null
  }
}

export interface SessionState {
  mode: SessionMode
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
  /** 下一道要出的计划题下标；作答后即 +1 */
  index: number
  ladders: Record<MasteryKey, LadderState>
  progress: SessionProgress
  boss: Tally
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  phase: SessionPhase
  current: CurrentItem | null
  lastGrade: GradeResult | null
  wrongThisSession: ExerciseSpec[]
  summary: SessionSummary | null
}

export interface AttemptRecord {
  /** ISO 时间戳，仅作记录，不参与任何判定 */
  at: string
  day: number
  sessionNo: number
  kpId: KnowledgePointId
  modality: Modality
  /** 实时规格（含档位与 seed），可复现该题 */
  spec: ExerciseSpec
  correct: boolean
  latencyMs: number
  detail: GradeResult['detail']
}

export interface SessionRecord {
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
  index: number
  progress: SessionProgress
  boss: Tally
  byTrack: Record<Track, number>
  reliefTriggered: boolean
  completed: boolean
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'contentPlayed' }
  | { type: 'answer'; response: Response; latencyMs: number }
  | { type: 'interrupted' }
  | { type: 'next' }
  | { type: 'endEarly' }

export type SessionEffect =
  | { type: 'play'; plan: PlaybackPlan; contentStartSec: number }
  | { type: 'stopAudio' }
  | { type: 'saveAttempt'; attempt: AttemptRecord }
  | { type: 'saveMastery'; key: MasteryKey; state: MasteryState }
  | { type: 'saveSession'; record: SessionRecord }
  | { type: 'advancePhase'; from: PhaseId; to: PhaseId; day: number }
  | { type: 'itemError'; spec: ExerciseSpec; message: string }
  | { type: 'ended'; summary: SessionSummary }

export interface ReduceContext {
  curriculum: Curriculum
  /** 只读；变化经 saveMastery 副作用交给壳层 */
  mastery: MasteryStore
  /** 作答记录的时间戳，由壳层传入 */
  nowIso: string
}

export interface ReduceResult {
  state: SessionState
  effects: SessionEffect[]
}
