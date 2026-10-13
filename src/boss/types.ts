import type { PhaseId } from '../curriculum/stages'
import type { MeterId } from '../exercises/data/rhythms'
import type { Key, ScaleDegree } from '../music/key'

/** 每个部分都 ≥ 此比例才算通过（P-5 spec D2） */
export const BOSS_PASS_RATIO = 0.9
/** 每句小节数（P-5 spec D3） */
export const PHRASE_BARS = 2
/** 每天最多尝试次数（P-5 spec D2） */
export const BOSS_ATTEMPTS_PER_DAY = 3

export type PartId = 'melody' | 'chords' | 'rhythm' | 'meter' | 'newTonic'

export interface MelodyNote {
  degree: ScaleDegree
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
  /** 每小节一个音型 id（仅 4/4 用音型库时）；否则 null */
  rhythm: string[] | null
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
