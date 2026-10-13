import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Chord, ChordQuality } from '../../music/chord'
import type { Mode, ScaleDegree } from '../../music/key'

export type ChordFamily = 'quality' | 'functional' | 'progression' | 'inversion' | 'bassline'
export type ChordPool =
  | 'quality'
  | 'major-functional'
  | 'minor-functional'
  | 'major-progression'
  | 'minor-progression'
  | 'inversion'
  | 'bassline'

interface EntryBase {
  kpId: KnowledgePointId
  mode: Mode
  pool: ChordPool
  /** 作答用的语义 id，同池内唯一 */
  answerId: string
}

export interface QualityEntry extends EntryBase {
  family: 'quality'
  quality: 'maj' | 'min'
}
export interface FunctionalEntry extends EntryBase {
  family: 'functional'
  chord: Chord
}
export interface ProgressionEntry extends EntryBase {
  family: 'progression'
  /** 同调式功能和弦的 answerId */
  chordIds: readonly string[]
}
export interface InversionEntry extends EntryBase {
  family: 'inversion'
  inversion: 1 | 2
}
export interface BasslineEntry extends EntryBase {
  family: 'bassline'
}
export type ChordEntry =
  | QualityEntry
  | FunctionalEntry
  | ProgressionEntry
  | InversionEntry
  | BasslineEntry

const C = (name: string) => makeKpId('chord', name)
const P = (name: string) => makeKpId('prog', name)

const fn = (
  name: string,
  mode: Mode,
  answerId: string,
  rootDegree: ScaleDegree,
  quality: ChordQuality,
): FunctionalEntry => ({
  kpId: C(name),
  mode,
  pool: mode === 'major' ? 'major-functional' : 'minor-functional',
  answerId,
  family: 'functional',
  chord: { rootDegree, quality, inversion: 0 },
})

const prog = (name: string, mode: Mode): ProgressionEntry => ({
  kpId: P(name),
  mode,
  pool: mode === 'major' ? 'major-progression' : 'minor-progression',
  answerId: name,
  family: 'progression',
  chordIds: name.split('-'),
})

/** H 轨知识点的音乐含义（P-2b spec §7.3）。增加知识点 = 加一行 */
export const CHORD_ENTRIES: readonly ChordEntry[] = [
  { kpId: C('quality-maj'), mode: 'major', pool: 'quality', answerId: 'maj', family: 'quality', quality: 'maj' },
  { kpId: C('quality-min'), mode: 'major', pool: 'quality', answerId: 'min', family: 'quality', quality: 'min' },
  fn('I', 'major', 'I', 'do', 'maj'),
  fn('IV', 'major', 'IV', 'fa', 'maj'),
  fn('V', 'major', 'V', 'sol', 'maj'),
  fn('vi', 'major', 'vi', 'la', 'min'),
  fn('ii', 'major', 'ii', 're', 'min'),
  fn('V7', 'major', 'V7', 'sol', 'dom7'),
  fn('Imaj7', 'major', 'Imaj7', 'do', 'maj7'),
  fn('ii7', 'major', 'ii7', 're', 'min7'),
  fn('vi7', 'major', 'vi7', 'la', 'min7'),
  fn('V-of-V', 'major', 'V/V', 're', 'maj'),
  fn('borrowed-bVI', 'major', 'bVI', 'le', 'maj'),
  fn('borrowed-bVII', 'major', 'bVII', 'te', 'maj'),
  // 小调（la 基）：主音 la，do 是三级
  fn('i', 'minor', 'i', 'la', 'min'),
  fn('iv', 'minor', 'iv', 're', 'min'),
  fn('III', 'minor', 'III', 'do', 'maj'),
  fn('VI', 'minor', 'VI', 'fa', 'maj'),
  fn('VII', 'minor', 'VII', 'sol', 'maj'),
  prog('I-V-vi-IV', 'major'),
  prog('vi-IV-I-V', 'major'),
  prog('I-vi-IV-V', 'major'),
  prog('i-VI-III-VII', 'minor'),
  { kpId: C('inv-first'), mode: 'major', pool: 'inversion', answerId: 'first', family: 'inversion', inversion: 1 },
  { kpId: C('inv-second'), mode: 'major', pool: 'inversion', answerId: 'second', family: 'inversion', inversion: 2 },
  { kpId: C('bassline'), mode: 'major', pool: 'bassline', answerId: 'bassline', family: 'bassline' },
]

const BY_ID = new Map(CHORD_ENTRIES.map((e) => [e.kpId, e]))

export function chordEntry(kpId: KnowledgePointId): ChordEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireChordEntry(kpId: KnowledgePointId): ChordEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`H 轨数据表没有知识点 ${kpId}`)
  return e
}

export function chordPoolOf(kpId: KnowledgePointId): ChordPool | undefined {
  return BY_ID.get(kpId)?.pool
}

export function functionalChord(mode: Mode, answerId: string): Chord {
  const e = CHORD_ENTRIES.find(
    (x): x is FunctionalEntry => x.family === 'functional' && x.mode === mode && x.answerId === answerId,
  )
  if (!e) throw new Error(`没有 ${mode} 调式的功能和弦 ${answerId}`)
  return e.chord
}

export const QUALITY_IDS = ['maj', 'min'] as const

export const INVERSION_IDS = ['root', 'first', 'second'] as const
export const INVERSION_OF: Record<(typeof INVERSION_IDS)[number], number> = {
  root: 0,
  first: 1,
  second: 2,
}

export const TONIC_CHORD_ID: Record<Mode, string> = { major: 'I', minor: 'i' }

/** 转位题从这三个和弦里抽（H6 的前置是 I/IV/V） */
export const INVERSION_CHORD_IDS = ['I', 'IV', 'V'] as const

export interface BasslinePattern {
  /** 低音音级用 - 连接，也是听辨题的选项 id */
  id: string
  steps: readonly { chordId: string; inversion: number }[]
}

/** 低音线模板（大调）：四条走向各不相同，两条下行两条上行 */
export const BASSLINE_PATTERNS: readonly BasslinePattern[] = [
  { id: 'do-ti-la-fa', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'V', inversion: 1 }, { chordId: 'vi', inversion: 0 }, { chordId: 'IV', inversion: 0 }] },
  { id: 'do-mi-fa-sol', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'I', inversion: 1 }, { chordId: 'IV', inversion: 0 }, { chordId: 'V', inversion: 0 }] },
  { id: 'do-re-mi-fa', steps: [{ chordId: 'I', inversion: 0 }, { chordId: 'V', inversion: 2 }, { chordId: 'I', inversion: 1 }, { chordId: 'IV', inversion: 0 }] },
  { id: 'fa-sol-la-ti', steps: [{ chordId: 'IV', inversion: 0 }, { chordId: 'V', inversion: 0 }, { chordId: 'vi', inversion: 0 }, { chordId: 'V', inversion: 1 }] },
]
