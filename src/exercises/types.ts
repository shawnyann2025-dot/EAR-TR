import type { Curriculum } from '../curriculum/curriculum'
import type { Modality } from '../curriculum/knowledgePoints'
import type { Key, Mode, ScaleDegree } from '../music/key'
import type { NoteSpec, PlaybackPlan, TimbreId } from '../music/playback'
import type { Rng } from '../music/rng'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'

/** 选项。id 是语义 id（'re'、'V'、'q-ee-q-q'、'shift'），显示文案由显示层换皮 */
export interface AnswerOption {
  id: string
}

export interface PitchTarget {
  degree: ScaleDegree
  midi: number
  freqHz: number
  /** 主 spec §9：±50 音分 */
  centsTolerance: number
}

export type AnswerFormat =
  | { kind: 'choice'; options: AnswerOption[] }
  | { kind: 'sequence'; length: number; alphabet: AnswerOption[] }
  | { kind: 'pitch'; targets: PitchTarget[] }
  | { kind: 'tap'; onsetsSec: number[]; toleranceSec: number }

export type Answer =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  | { kind: 'pitch'; targets: PitchTarget[] }
  | { kind: 'tap'; onsetsSec: number[] }

export type Response =
  | { kind: 'choice'; id: string }
  | { kind: 'sequence'; ids: string[] }
  /** P-2b / P-3：自评。P-4 增加检测结果分支 */
  | { kind: 'pitch'; selfAssessedCorrect: boolean }
  | { kind: 'tap'; tapsSec: number[] }

export interface ResolvedVariation {
  key: Key
  timbreId: TimbreId
  centerMidi: number
  bpm: number
  velocity: number
  presentation: 'block' | 'arpeggio'
}

export interface FeedbackPlan {
  /** 主 spec §6.4 第 1 条：锚点（主音 / 节拍器）→ 题目内容 */
  replay: PlaybackPlan
  /** 主 spec §6.4 第 3 条：同一内容按 SLOW_FACTOR 放慢 */
  slow: PlaybackPlan
}

export type PromptId =
  | 'which-degree' | 'sing-degrees' | 'notate-melody'
  | 'did-it-modulate' | 'sing-new-tonic' | 'new-tonic-degree'
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords'
  | 'which-progression' | 'sing-bassline' | 'notate-progression'
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline'
  | 'which-pattern' | 'tap-pattern' | 'notate-patterns'
  | 'which-meter' | 'tap-downbeats' | 'which-onset-is-beat-one'
  | 'which-pickup' | 'which-meter-sequence' | 'notate-meters'

export interface Exercise {
  spec: ExerciseSpec
  resolved: ResolvedVariation
  /** 语境 + 题目内容，可直接交给 AudioEngine */
  plan: PlaybackPlan
  /** 题目内容在 plan 中的起点 */
  contentStartSec: number
  prompt: PromptId
  format: AnswerFormat
  answer: Answer
  feedback: FeedbackPlan
}

export interface GradeResult {
  correct: boolean
  detail:
    | { kind: 'choice' }
    | { kind: 'sequence'; positions: boolean[] }
    | { kind: 'pitch' }
    | { kind: 'tap'; offsetsSec: number[] }
}

export interface GeneratorInput {
  spec: ExerciseSpec
  curriculum: Curriculum
  resolved: ResolvedVariation
  /** doMidiForKey(resolved.key, resolved.centerMidi) */
  doMidi: number
  rng: Rng
}

/** 管线第 2 步的产出。时刻全部相对题目内容起点（0） */
export interface ContentResult {
  /** 题目里实际播放的内容（唱模态可为空） */
  notes: NoteSpec[]
  /** 反馈重放用的内容（唱模态为目标音，其余与 notes 相同） */
  feedbackNotes: NoteSpec[]
  /** 题目内容时长，供语境伸缩（L2/L4 的持续低音要覆盖它） */
  durSec: number
  prompt: PromptId
  format: AnswerFormat
  answer: Answer
}

export type Generator = (input: GeneratorInput) => ContentResult

export interface GeneratorEntry {
  mode: Mode
  byModality: Record<Modality, Generator>
}
