import type { PhaseId } from '../curriculum/stages'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { archiveOverflow } from './archive'
import {
  ATTEMPT_CAP,
  SCHEMA_VERSION,
  type AttemptAggregate,
  type BossAttempt,
  type ExportBundle,
  type GateRecord,
  type Profile,
  type Repository,
} from './types'

const clone = <T>(x: T): T => structuredClone(x)
/** 按 UTF-16 码元序比较，与 IndexedDB 键排序一致；导出顺序两种实现统一 */
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sessionKey = (day: number, sessionNo: number) => `${day}:${sessionNo}`

/** 内存实现：测试用，也是隐私模式下的降级（主 spec §12） */
export class MemoryRepository implements Repository {
  private profile: Profile | null = null
  private mastery = new Map<MasteryKey, MasteryState>()
  private attempts: AttemptRecord[] = []
  private aggregates: AttemptAggregate[] = []
  private sessions = new Map<string, SessionRecord>()
  private gates: GateRecord[] = []
  private bossAttempts: BossAttempt[] = []
  private readonly cap: number

  constructor(opts: { attemptCap?: number } = {}) {
    this.cap = opts.attemptCap ?? ATTEMPT_CAP
  }

  async loadProfile() {
    return this.profile ? clone(this.profile) : null
  }
  async saveProfile(p: Profile) {
    this.profile = clone(p)
  }
  async loadMastery() {
    return new Map([...this.mastery].map(([k, v]) => [k, clone(v)]))
  }
  async putMastery(key: MasteryKey, s: MasteryState) {
    this.mastery.set(key, clone(s))
  }
  async appendAttempt(a: AttemptRecord) {
    const r = archiveOverflow([...this.attempts, clone(a)], this.aggregates, this.cap)
    this.attempts = r.attempts
    this.aggregates = r.aggregates
  }
  async countAttempts() {
    return this.attempts.length
  }
  async loadSession(day: number, sessionNo: number) {
    const r = this.sessions.get(sessionKey(day, sessionNo))
    return r ? clone(r) : null
  }
  async latestSessionNo(day: number) {
    const nos = [...this.sessions.values()].filter((s) => s.day === day).map((s) => s.sessionNo)
    return nos.length > 0 ? Math.max(...nos) : null
  }
  async putSession(r: SessionRecord) {
    this.sessions.set(sessionKey(r.day, r.sessionNo), clone(r))
  }
  async putGate(g: GateRecord) {
    this.gates.push(clone(g))
  }
  async appendBossAttempt(a: BossAttempt) {
    this.bossAttempts.push(clone(a))
  }
  async listBossAttempts(phaseId?: PhaseId) {
    return clone(this.bossAttempts.filter((a) => phaseId === undefined || a.phaseId === phaseId))
  }
  async exportAll(exportedAt: string): Promise<ExportBundle> {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      profile: this.profile,
      mastery: [...this.mastery.entries()].sort((a, b) => byKey(a[0], b[0])),
      attempts: this.attempts,
      attemptAggregates: [...this.aggregates].sort((a, b) => byKey(a.key, b.key)),
      sessions: [...this.sessions.values()].sort((a, b) => a.day - b.day || a.sessionNo - b.sessionNo),
      gates: this.gates,
      bossAttempts: this.bossAttempts,
    })
  }
  async importAll(bundle: ExportBundle) {
    const b = clone(bundle)
    const mastery = new Map(b.mastery)
    const sessions = new Map(b.sessions.map((s) => [sessionKey(s.day, s.sessionNo), s]))
    this.profile = b.profile
    this.mastery = mastery
    this.attempts = b.attempts
    this.aggregates = b.attemptAggregates
    this.sessions = sessions
    this.gates = b.gates
    this.bossAttempts = b.bossAttempts ?? []
  }
}
