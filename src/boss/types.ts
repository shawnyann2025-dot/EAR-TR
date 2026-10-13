import type { PhaseId } from '../curriculum/stages'
import type { MeterId } from '../exercises/data/rhythms'
import type { Key, ScaleDegree } from '../music/key'

/** 每个部分都 ≥ 此比例才算通过（P-5 spec D2） */
export const BOSS_PASS_RATIO = 0.9
/** 每句小节数（P-5 spec D3） */
export const PHRASE_BARS = 2
/** 每天最多尝试次数（P-5 spec D2） */
export const BOSS_ATTEMPTS_PER_DAY = 3
/** 旋律中心音（MIDI）：各调的「本位 do」取离它最近的那个 do（doMidiForKey），MelodyNote.octave 相对它计 */
export const MELODY_CENTER_MIDI = 67

export type PartId = 'melody' | 'chords' | 'rhythm' | 'meter' | 'newTonic'

export interface MelodyNote {
  degree: ScaleDegree
  /** 相对所在调「本位 do」（离 MELODY_CENTER_MIDI 最近的 do）的八度数；0 = 本位八度 */
  octave: number
  /** 所在调：0 = 原调，1 = 转调后（仅 P5） */
  keyIndex: 0 | 1
  /** 从第一小节起的四分音符拍数 */
  atBeat: number
  durBeats: number
}

export interface Piece {
  phaseId: PhaseId
  seed: number
  /** keys[0] 原调；P5 有 keys[1] 新调 */
  keys: Key[]
  /** 新调开始的小节（0 起）；无转调为 null */
  modulationBar: number | null
  bpm: number
  meterId: MeterId
  bars: number
  melody: MelodyNote[]
  /** 每小节一个和弦（所在调的级数 id）；无和声为 null */
  chords: string[] | null
  /** 每小节一个音型 id（仅节奏是作答部分时，即 P4）；否则 null */
  rhythm: string[] | null
  /** 每小节和弦的转位（0 原位、1 第一转位），渲染低音用；答案仍是级数 id。仅 P4 且已解锁第一转位时有，否则 null */
  inversions: (0 | 1)[] | null
  drums: boolean
}

export interface Phrase {
  index: number
  startBar: number
  /** 不含 */
  endBar: number
  melodyCount: number
}

export interface BossAnswer {
  /** 按乐句分组的旋律音级 id */
  melody: string[][]
  chords?: string[]
  rhythm?: string[]
  meter?: string
  newTonic?: string
}

export type BossResponse = BossAnswer

export interface BossChallenge {
  piece: Piece
  parts: PartId[]
  phrases: Phrase[]
  answer: BossAnswer
  alphabets: { melody: string[]; chords?: string[]; rhythm?: string[]; meter?: string[]; newTonic?: string[] }
}
