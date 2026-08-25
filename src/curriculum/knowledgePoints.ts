/** 三条并行轨道：T 音级、H 和声、R 节奏（spec §6.3） */
export type Track = 'T' | 'H' | 'R'

/** 三个模态。一个知识点要毕业必须三者齐平（spec §8.3） */
export type Modality = 'recognize' | 'sing' | 'notate'

export const MODALITIES: readonly Modality[] = ['recognize', 'sing', 'notate']

export type KnowledgePointKind = 'degree' | 'chord' | 'prog' | 'rhythm'

const KIND_TRACK: Record<KnowledgePointKind, Track> = {
  degree: 'T',
  chord: 'H',
  prog: 'H',
  rhythm: 'R',
}

/** 形如 `${kind}:${name}`，例如 `degree:major:mi`、`prog:I-V-vi-IV` */
export type KnowledgePointId = string

/** 形如 `${kpId}@${modality}`，掌握度状态的唯一键 */
export type MasteryKey = string

export interface KnowledgePoint {
  id: KnowledgePointId
  kind: KnowledgePointKind
  track: Track
  /** 中文显示名，供 UI 与调试输出用 */
  label: string
  prerequisites: KnowledgePointId[]
}

export function trackOfKind(kind: KnowledgePointKind): Track {
  return KIND_TRACK[kind]
}

export function makeKpId(kind: KnowledgePointKind, name: string): KnowledgePointId {
  return `${kind}:${name}`
}

/**
 * 只在第一个冒号处切分——name 本身可以含冒号
 * （`degree:major:mi` 的 name 是 `major:mi`）。
 */
export function parseKpId(id: KnowledgePointId): {
  kind: KnowledgePointKind
  name: string
} {
  const idx = id.indexOf(':')
  if (idx < 0) throw new Error(`知识点 id 必须形如 kind:name，收到 ${id}`)
  const kind = id.slice(0, idx)
  if (!(kind in KIND_TRACK)) {
    throw new Error(`未知的知识点类型 ${kind}（id: ${id}）`)
  }
  return { kind: kind as KnowledgePointKind, name: id.slice(idx + 1) }
}

export function masteryKey(kpId: KnowledgePointId, modality: Modality): MasteryKey {
  return `${kpId}@${modality}`
}

export function parseMasteryKey(key: MasteryKey): {
  kpId: KnowledgePointId
  modality: Modality
} {
  const idx = key.lastIndexOf('@')
  if (idx < 0) throw new Error(`掌握度 key 必须形如 kpId@modality，收到 ${key}`)
  const modality = key.slice(idx + 1)
  if (!MODALITIES.includes(modality as Modality)) {
    throw new Error(`未知模态 ${modality}（key: ${key}）`)
  }
  return { kpId: key.slice(0, idx), modality: modality as Modality }
}
