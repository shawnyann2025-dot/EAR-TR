import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import type { DisplayScheme } from '../music/display'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'

export const SCHEMA_VERSION = 1
/** 作答全量留存上限（主 spec §10.2） */
export const ATTEMPT_CAP = 50_000

export interface Profile {
  id: string
  /** 'YYYY-MM-DD'，本地日历日 */
  createdAtLocalDate: string
  phaseId: PhaseId
  displayScheme: DisplayScheme
  placement: { done: boolean; startPhase: PhaseId | null }
  schemaVersion: number
}

export interface GateRecord {
  phaseId: PhaseId
  passedOnDay: number
}

export interface AttemptAggregate {
  key: MasteryKey
  attempts: number
  correct: number
}

export interface ExportBundle {
  schemaVersion: number
  exportedAt: string
  profile: Profile | null
  mastery: [MasteryKey, MasteryState][]
  attempts: AttemptRecord[]
  attemptAggregates: AttemptAggregate[]
  sessions: SessionRecord[]
  gates: GateRecord[]
}

export interface Repository {
  loadProfile(): Promise<Profile | null>
  saveProfile(p: Profile): Promise<void>
  loadMastery(): Promise<Map<MasteryKey, MasteryState>>
  putMastery(key: MasteryKey, s: MasteryState): Promise<void>
  appendAttempt(a: AttemptRecord): Promise<void>
  countAttempts(): Promise<number>
  loadSession(day: number, sessionNo: number): Promise<SessionRecord | null>
  latestSessionNo(day: number): Promise<number | null>
  putSession(r: SessionRecord): Promise<void>
  putGate(g: GateRecord): Promise<void>
  exportAll(exportedAt: string): Promise<ExportBundle>
  /** 先校验与迁移再整体替换；任何一步失败都不改现有数据 */
  importAll(bundle: ExportBundle): Promise<void>
}

/** 数据损坏：带一份尽力读出的原始数据，供用户先下载再重建（主 spec §10.3） */
export class StorageCorruptError extends Error {
  constructor(message: string, readonly rawDump: string) {
    super(message)
    this.name = 'StorageCorruptError'
  }
}

export class StorageImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageImportError'
  }
}

/** 本地存储不可用（无 IndexedDB、隐私模式、被占用等）：运行时据此降级到内存仓库（主 spec §12） */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageUnavailableError'
  }
}
