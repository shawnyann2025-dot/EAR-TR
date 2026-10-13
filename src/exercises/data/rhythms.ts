import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Meter } from '../../music/rhythm'

export type RhythmFamily = 'pattern' | 'meter' | 'beat-one' | 'anacrusis' | 'mixed-meter'
export type MeterId = '2/4' | '3/4' | '4/4' | '6/8'

/** 6/8 按记谱拍数填写：六个八分音符（FWD-6） */
export const METERS: Record<MeterId, Meter> = {
  '2/4': { beatsPerBar: 2, beatUnit: 4 },
  '3/4': { beatsPerBar: 3, beatUnit: 4 },
  '4/4': { beatsPerBar: 4, beatUnit: 4 },
  '6/8': { beatsPerBar: 6, beatUnit: 8 },
}

export interface RhythmEntry {
  kpId: KnowledgePointId
  family: RhythmFamily
  pool: RhythmFamily
  /** 只有拍号类知识点有 */
  meterId?: MeterId
}

const R = (name: string) => makeKpId('rhythm', name)
const row = (name: string, family: RhythmFamily, meterId?: MeterId): RhythmEntry => ({
  kpId: R(name),
  family,
  pool: family,
  ...(meterId ? { meterId } : {}),
})

/** R 轨知识点（P-2b spec §7.4）。增加知识点 = 加一行 */
export const RHYTHM_ENTRIES: readonly RhythmEntry[] = [
  row('beat-one', 'beat-one'),
  row('meter-2-4', 'meter', '2/4'),
  row('meter-3-4', 'meter', '3/4'),
  row('quarter', 'pattern'),
  row('eighth-pair', 'pattern'),
  row('dotted', 'pattern'),
  row('rest', 'pattern'),
  row('sixteenth', 'pattern'),
  row('synco-8', 'pattern'),
  row('triplet', 'pattern'),
  row('meter-6-8', 'meter', '6/8'),
  row('anacrusis', 'anacrusis'),
  row('tie-across-bar', 'pattern'),
  row('mixed-meter', 'mixed-meter'),
  row('synco-16', 'pattern'),
]

const BY_ID = new Map(RHYTHM_ENTRIES.map((e) => [e.kpId, e]))

export function rhythmEntry(kpId: KnowledgePointId): RhythmEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireRhythmEntry(kpId: KnowledgePointId): RhythmEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`R 轨数据表没有知识点 ${kpId}`)
  return e
}

export function rhythmPoolOf(kpId: KnowledgePointId): RhythmFamily | undefined {
  return BY_ID.get(kpId)?.pool
}

/** 4/4 里的一个音：起音与时值都以四分音符为单位，可跨小节 */
export interface PatternNote {
  onset: number
  dur: number
}

export interface PatternDef {
  /** 选项 id；显示层按它画节奏型 */
  id: string
  ownerKpId: KnowledgePointId
  bars: 1 | 2
  /** 对比用音型——只出现在选项与听写字母表里，永远不被抽作目标（它不体现所属知识点） */
  targetable?: false
  notes: readonly PatternNote[]
}

const n = (onset: number, dur: number): PatternNote => ({ onset, dur })
const T = 1 / 3

/** 音型库（全部 4/4）。每个音型类知识点拥有至少一个能体现它的音型 */
export const PATTERNS: readonly PatternDef[] = [
  { id: 'q-q-q-q', ownerKpId: R('quarter'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-h', ownerKpId: R('quarter'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, 2)] },
  { id: 'ee-q-q-q', ownerKpId: R('eighth-pair'), bars: 1, notes: [n(0, 0.5), n(0.5, 0.5), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-ee-q-ee', ownerKpId: R('eighth-pair'), bars: 1, notes: [n(0, 1), n(1, 0.5), n(1.5, 0.5), n(2, 1), n(3, 0.5), n(3.5, 0.5)] },
  { id: 'dq-e-q-q', ownerKpId: R('dotted'), bars: 1, notes: [n(0, 1.5), n(1.5, 0.5), n(2, 1), n(3, 1)] },
  { id: 'q-dq-e-q', ownerKpId: R('dotted'), bars: 1, notes: [n(0, 1), n(1, 1.5), n(2.5, 0.5), n(3, 1)] },
  { id: 'q-r-q-q', ownerKpId: R('rest'), bars: 1, notes: [n(0, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-r-q', ownerKpId: R('rest'), bars: 1, notes: [n(0, 1), n(1, 1), n(3, 1)] },
  { id: 'ssss-q-q-q', ownerKpId: R('sixteenth'), bars: 1, notes: [n(0, 0.25), n(0.25, 0.25), n(0.5, 0.25), n(0.75, 0.25), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-ssss-q-q', ownerKpId: R('sixteenth'), bars: 1, notes: [n(0, 1), n(1, 0.25), n(1.25, 0.25), n(1.5, 0.25), n(1.75, 0.25), n(2, 1), n(3, 1)] },
  { id: 'e-q-e-q-q', ownerKpId: R('synco-8'), bars: 1, notes: [n(0, 0.5), n(0.5, 1), n(1.5, 0.5), n(2, 1), n(3, 1)] },
  { id: 'q-e-q-e-q', ownerKpId: R('synco-8'), bars: 1, notes: [n(0, 1), n(1, 0.5), n(1.5, 1), n(2.5, 0.5), n(3, 1)] },
  { id: 'trip-q-q-q', ownerKpId: R('triplet'), bars: 1, notes: [n(0, T), n(T, T), n(2 * T, T), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-q-trip-q', ownerKpId: R('triplet'), bars: 1, notes: [n(0, 1), n(1, 1), n(2, T), n(2 + T, T), n(2 + 2 * T, T), n(3, 1)] },
  // 第一小节第四拍后半起音，连线延续到第二小节第一拍——第二小节第一拍没有起音
  { id: 'q-q-q-e~q-q-q', ownerKpId: R('tie-across-bar'), bars: 2, notes: [n(0, 1), n(1, 1), n(2, 1), n(3.5, 1.5), n(5, 1), n(6, 1), n(7, 1)] },
  // 与连线音型只差第二小节第一拍重新起音——听辨两小节题时，靠的是听出连线，而不是看长度
  { id: 'q-q-q-e|q-q-q-q', ownerKpId: R('tie-across-bar'), bars: 2, targetable: false, notes: [n(0, 1), n(1, 1), n(2, 1), n(3.5, 0.5), n(4, 1), n(5, 1), n(6, 1), n(7, 1)] },
  { id: 's-e-s-q-q-q', ownerKpId: R('synco-16'), bars: 1, notes: [n(0, 0.25), n(0.25, 0.5), n(0.75, 0.25), n(1, 1), n(2, 1), n(3, 1)] },
  { id: 'q-s-e-s-q-q', ownerKpId: R('synco-16'), bars: 1, notes: [n(0, 1), n(1, 0.25), n(1.25, 0.5), n(1.75, 0.25), n(2, 1), n(3, 1)] },
]

/** 返回能作为该知识点目标抽取的音型（排除对比用音型）。 */
export function patternsOf(kpId: KnowledgePointId): PatternDef[] {
  return PATTERNS.filter((p) => p.ownerKpId === kpId && p.targetable !== false)
}

export function patternById(id: string): PatternDef {
  const p = PATTERNS.find((x) => x.id === id)
  if (!p) throw new Error(`音型库里没有 ${id}`)
  return p
}

export const PICKUP_IDS = ['none', 'half', 'one'] as const
export type PickupId = (typeof PICKUP_IDS)[number]

/** 弱起落在第 0 小节（4/4）末尾；none 表示第 0 小节全空 */
export const PICKUPS: Record<PickupId, readonly PatternNote[]> = {
  none: [],
  half: [n(3.5, 0.5)],
  one: [n(3, 1)],
}

export interface MixedCombo {
  /** 拍号用 + 连接，也是听辨题的选项 id */
  id: string
  meters: readonly MeterId[]
}

export const MIXED_COMBOS: readonly MixedCombo[] = [
  { id: '3/4+2/4', meters: ['3/4', '2/4'] },
  { id: '2/4+3/4', meters: ['2/4', '3/4'] },
  { id: '4/4+3/4', meters: ['4/4', '3/4'] },
  { id: '3/4+4/4', meters: ['3/4', '4/4'] },
]

/** 混合拍子听写的字母表 */
export const MIXED_METER_ALPHABET: readonly MeterId[] = ['2/4', '3/4', '4/4']

/** 找 beat 1 的片段从这些拍号里抽 */
export const BEAT_ONE_METERS: readonly MeterId[] = ['2/4', '3/4', '4/4']
