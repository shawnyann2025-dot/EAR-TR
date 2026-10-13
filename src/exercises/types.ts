import type { Curriculum } from '../curriculum/curriculum'
import type { Modality } from '../curriculum/knowledgePoints'
import type { Key, Mode, ScaleDegree } from '../music/key'
import type { NoteSpec, PlaybackPlan, TimbreId } from '../music/playback'
import type { Meter } from '../music/rhythm'
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
  | {
      kind: 'tap'
      onsetsSec: number[]
      toleranceSec: number
      /** 首击允许的最大偏移（秒）——吸收反应延迟，但不能大到整串平移到别的拍上；生成器取半个感知拍 */
      maxShiftSec: number
      /** 作答窗口（秒）：内容时长，相对 contentStartSec；内容无声的题 P-3 靠它知道收多久的拍 */
      windowSec: number
      /** 「打出给定音型」类题：屏幕上要显示的音型 / 弱起 id；边听边打强拍的题不给 */
      patternIds?: string[]
    }

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
  /** P-4：检测到的各稳定段中位数（Hz），按唱的先后 */
  | { kind: 'pitch'; sungHz: number[] }
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
  | 'which-quality' | 'which-chord' | 'sing-arpeggio' | 'notate-chords' | 'notate-qualities'
  | 'which-progression' | 'sing-bassline' | 'notate-progression'
  | 'which-inversion' | 'which-bass-contour' | 'notate-bassline' | 'notate-inversions'
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
    | { kind: 'pitch'; perTarget?: boolean[]; centsOff?: (number | null)[] }
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

/** 节拍器模式：metered 按拍号分组、强拍加重；neutral 不透露拍号与强拍（P-2b-R 裁定 1） */
export type MetronomeMode = 'metered' | 'neutral'

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
  /** 节拍器语境需要的小节结构；只有 context 为 metronome 的生成器才给 */
  rhythm?: {
    bars: readonly Meter[]
    metronome: MetronomeMode
    /**
     * 题目内容的时刻 0 对应小节网格里的第几个感知拍（默认 0）。
     * 从小节中间开始的内容（找 beat 1、弱起）去掉前面的空拍，让预备拍不落在第一拍上。
     * 只用于中性节拍器。
     * 生成器负责把自己的起音与答案一起前移 startPulse 个感知拍。
     */
    startPulse?: number
  }
}

export type Generator = (input: GeneratorInput) => ContentResult

export interface GeneratorEntry {
  mode: Mode
  /** tonal：调性语境（主 spec §6.1）；metronome：节拍器语境（P-2b spec §7.1） */
  context: 'tonal' | 'metronome'
  byModality: Record<Modality, Generator>
}
