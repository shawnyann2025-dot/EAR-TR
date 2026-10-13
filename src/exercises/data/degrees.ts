import { makeKpId, type KnowledgePointId } from '../../curriculum/knowledgePoints'
import type { Mode, ScaleDegree } from '../../music/key'

export type DegreePool = 'major' | 'minor' | 'modulation'

export interface DegreeEntry {
  kpId: KnowledgePointId
  mode: Mode
  /** 枚举里的稳定音级名（主 spec §4）。显示层的语境拼写见主 spec §15.1 */
  degree: ScaleDegree
  pool: DegreePool
}

const row = (name: string, mode: Mode, degree: ScaleDegree, pool: DegreePool): DegreeEntry => ({
  kpId: makeKpId('degree', name),
  mode,
  degree,
  pool,
})

/** T 轨知识点的音乐含义（P-2b spec §7.2）。增加知识点 = 加一行 */
export const DEGREE_ENTRIES: readonly DegreeEntry[] = [
  row('major:do', 'major', 'do', 'major'),
  row('major:mi', 'major', 'mi', 'major'),
  row('major:sol', 'major', 'sol', 'major'),
  row('major:re', 'major', 're', 'major'),
  row('major:la', 'major', 'la', 'major'),
  row('major:fa', 'major', 'fa', 'major'),
  row('major:ti', 'major', 'ti', 'major'),
  row('major:fi', 'major', 'fi', 'major'),
  row('major:te', 'major', 'te', 'major'),
  row('major:me', 'major', 'me', 'major'),
  row('minor:la', 'minor', 'la', 'minor'),
  row('minor:do', 'minor', 'do', 'minor'),
  row('minor:mi', 'minor', 'mi', 'minor'),
  row('minor:ti', 'minor', 'ti', 'minor'),
  row('minor:re', 'minor', 're', 'minor'),
  row('minor:fa', 'minor', 'fa', 'minor'),
  row('minor:sol', 'minor', 'sol', 'minor'),
  // 和声小调导音：半音 8。枚举统一叫 le，显示成 si 归显示层（主 spec §15.1）
  row('minor:si', 'minor', 'le', 'minor'),
  // 旋律小调升 6：半音 6
  row('minor:fi', 'minor', 'fi', 'minor'),
  row('modulation:shift', 'major', 'do', 'modulation'),
]

const BY_ID = new Map(DEGREE_ENTRIES.map((e) => [e.kpId, e]))

export function degreeEntry(kpId: KnowledgePointId): DegreeEntry | undefined {
  return BY_ID.get(kpId)
}

export function requireDegreeEntry(kpId: KnowledgePointId): DegreeEntry {
  const e = BY_ID.get(kpId)
  if (!e) throw new Error(`T 轨数据表没有知识点 ${kpId}`)
  return e
}
