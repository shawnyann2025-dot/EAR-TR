import type { PhaseId } from '../curriculum/stages'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { archiveOverflow } from './archive'
import {
  ATTEMPT_CAP,
  SCHEMA_VERSION,
  StorageCorruptError,
  StorageUnavailableError,
  type AttemptAggregate,
  type BossAttempt,
  type ExportBundle,
  type GateRecord,
  type Profile,
  type Repository,
} from './types'

export const DB_NAME = 'ear-tr'
export const STORES = ['profile', 'mastery', 'attempts', 'attemptAggregates', 'sessions', 'gates', 'bossAttempts'] as const
type StoreName = (typeof STORES)[number]

const PROFILE_KEY = 'profile'
const sessionKey = (day: number, sessionNo: number) => `${day}:${sessionNo}`

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** 迁移：按版本串联（P-3 spec §4.3）。v1 = 建全部对象仓库；v2 = 加 bossAttempts（P-5b） */
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('profile')
    db.createObjectStore('mastery')
    db.createObjectStore('attempts', { autoIncrement: true })
    db.createObjectStore('attemptAggregates', { keyPath: 'key' })
    db.createObjectStore('sessions')
    db.createObjectStore('gates', { autoIncrement: true })
  }
  if (oldVersion < 2) db.createObjectStore('bossAttempts', { autoIncrement: true })
}

function open(factory: IDBFactory, name: string, version: number | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = version === undefined ? factory.open(name) : factory.open(name, version)
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion)
    r.onsuccess = () => {
      const db = r.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error('另一个标签页占用了旧版本数据库，请关闭其他标签页后重试'))
  })
}

/** 尽力读出全部数据（不论版本），供损坏时导出副本；每个仓库为 [键, 值] 对（保留 MasteryKey 等外置键） */
async function rawDump(factory: IDBFactory, name: string): Promise<string> {
  let db: IDBDatabase | undefined
  try {
    db = await open(factory, name, undefined)
    const out: Record<string, [IDBValidKey, unknown][]> = {}
    for (const store of Array.from(db.objectStoreNames)) {
      const os = db.transaction(store, 'readonly').objectStore(store)
      const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())])
      out[store] = keys.map((k, i) => [k, values[i]])
    }
    return JSON.stringify(out)
  } catch (e) {
    return JSON.stringify({ error: String(e) })
  } finally {
    db?.close()
  }
}

function isProfile(x: unknown): x is Profile {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.createdAtLocalDate === 'string' &&
    typeof p.phaseId === 'string' &&
    typeof p.displayScheme === 'string' &&
    typeof p.schemaVersion === 'number' &&
    typeof p.placement === 'object' &&
    p.placement !== null
  )
}

/** 按 UTF-16 码元序比较，与 IndexedDB 键排序一致（不用 localeCompare） */
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

class IndexedDbRepository implements Repository {
  constructor(private readonly db: IDBDatabase, private readonly cap: number) {}

  private tx(stores: StoreName | StoreName[], mode: IDBTransactionMode) {
    return this.db.transaction(stores, mode)
  }

  async loadProfile() {
    const p = await req(this.tx('profile', 'readonly').objectStore('profile').get(PROFILE_KEY))
    return (p as Profile | undefined) ?? null
  }
  async saveProfile(p: Profile) {
    const tx = this.tx('profile', 'readwrite')
    tx.objectStore('profile').put(p, PROFILE_KEY)
    await done(tx)
  }
  async loadMastery() {
    const tx = this.tx('mastery', 'readonly')
    const store = tx.objectStore('mastery')
    const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())])
    return new Map(keys.map((k, i) => [k as MasteryKey, values[i] as MasteryState]))
  }
  async putMastery(key: MasteryKey, s: MasteryState) {
    const tx = this.tx('mastery', 'readwrite')
    tx.objectStore('mastery').put(s, key)
    await done(tx)
  }
  /**
   * 所有请求都在同一事务内、由上一个请求的回调发起，中间不经过 await，
   * 避免事务在微任务间隙自动提交（TransactionInactiveError）。
   */
  appendAttempt(a: AttemptRecord): Promise<void> {
    try {
      return this.appendAttemptTx(a)
    } catch (e) {
      return Promise.reject(e)
    }
  }
  private appendAttemptTx(a: AttemptRecord): Promise<void> {
    const tx = this.tx(['attempts', 'attemptAggregates'], 'readwrite')
    const finished = done(tx)
    const attempts = tx.objectStore('attempts')
    const aggStore = tx.objectStore('attemptAggregates')
    attempts.add(a)
    const countReq = attempts.count()
    countReq.onsuccess = () => {
      const count = countReq.result
      if (count <= this.cap) return
      // 超出上限：最旧的按 MasteryKey 聚合后删除（主 spec §10.2）
      const overflowCount = count - this.cap
      const keysReq = attempts.getAllKeys(null, overflowCount)
      const rowsReq = attempts.getAll(null, overflowCount)
      const aggReq = aggStore.getAll()
      let pending = 3
      const next = () => {
        if (--pending > 0) return
        const { aggregates } = archiveOverflow(rowsReq.result as AttemptRecord[], aggReq.result as AttemptAggregate[], 0)
        for (const agg of aggregates) aggStore.put(agg)
        for (const k of keysReq.result) attempts.delete(k)
      }
      keysReq.onsuccess = rowsReq.onsuccess = aggReq.onsuccess = next
    }
    return finished
  }
  async countAttempts() {
    return req(this.tx('attempts', 'readonly').objectStore('attempts').count())
  }
  async loadSession(day: number, sessionNo: number) {
    const r = await req(this.tx('sessions', 'readonly').objectStore('sessions').get(sessionKey(day, sessionNo)))
    return (r as SessionRecord | undefined) ?? null
  }
  async latestSessionNo(day: number) {
    const all = (await req(this.tx('sessions', 'readonly').objectStore('sessions').getAll())) as SessionRecord[]
    const nos = all.filter((s) => s.day === day).map((s) => s.sessionNo)
    return nos.length > 0 ? Math.max(...nos) : null
  }
  async putSession(r: SessionRecord) {
    const tx = this.tx('sessions', 'readwrite')
    tx.objectStore('sessions').put(r, sessionKey(r.day, r.sessionNo))
    await done(tx)
  }
  async putGate(g: GateRecord) {
    const tx = this.tx('gates', 'readwrite')
    tx.objectStore('gates').add(g)
    await done(tx)
  }
  async appendBossAttempt(a: BossAttempt) {
    const tx = this.tx('bossAttempts', 'readwrite')
    tx.objectStore('bossAttempts').add(a)
    await done(tx)
  }
  async listBossAttempts(phaseId?: PhaseId) {
    const all = (await req(this.tx('bossAttempts', 'readonly').objectStore('bossAttempts').getAll())) as BossAttempt[]
    return all.filter((a) => phaseId === undefined || a.phaseId === phaseId)
  }
  async exportAll(exportedAt: string): Promise<ExportBundle> {
    const tx = this.tx([...STORES], 'readonly')
    const masteryStore = tx.objectStore('mastery')
    const [profile, mKeys, mValues, attempts, attemptAggregates, sessions, gates, bossAttempts] = await Promise.all([
      req(tx.objectStore('profile').get(PROFILE_KEY)),
      req(masteryStore.getAllKeys()),
      req(masteryStore.getAll()),
      req(tx.objectStore('attempts').getAll()),
      req(tx.objectStore('attemptAggregates').getAll()),
      req(tx.objectStore('sessions').getAll()),
      req(tx.objectStore('gates').getAll()),
      req(tx.objectStore('bossAttempts').getAll()),
    ])
    const mastery = mKeys.map((k, i) => [k as MasteryKey, mValues[i] as MasteryState] as [MasteryKey, MasteryState])
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      profile: (profile as Profile | undefined) ?? null,
      mastery: mastery.sort((a, b) => byKey(a[0], b[0])),
      attempts: attempts as AttemptRecord[],
      attemptAggregates: (attemptAggregates as AttemptAggregate[]).sort((a, b) => byKey(a.key, b.key)),
      sessions: (sessions as SessionRecord[]).sort((a, b) => a.day - b.day || a.sessionNo - b.sessionNo),
      gates: gates as GateRecord[],
      bossAttempts: bossAttempts as BossAttempt[],
    }
  }
  importAll(bundle: ExportBundle): Promise<void> {
    let tx: IDBTransaction
    try {
      tx = this.tx([...STORES], 'readwrite')
    } catch (e) {
      return Promise.reject(e)
    }
    return this.importInto(tx, bundle)
  }
  private importInto(tx: IDBTransaction, bundle: ExportBundle): Promise<void> {
    // 单一事务：清空并写入全部仓库；任何一步失败整个事务回滚，不改现有数据
    const finished = done(tx)
    try {
      for (const s of STORES) tx.objectStore(s).clear()
      if (bundle.profile) tx.objectStore('profile').put(bundle.profile, PROFILE_KEY)
      for (const [k, v] of bundle.mastery) tx.objectStore('mastery').put(v, k)
      for (const a of bundle.attempts) tx.objectStore('attempts').add(a)
      for (const g of bundle.attemptAggregates) tx.objectStore('attemptAggregates').put(g)
      for (const s of bundle.sessions) tx.objectStore('sessions').put(s, sessionKey(s.day, s.sessionNo))
      for (const g of bundle.gates) tx.objectStore('gates').add(g)
      for (const a of bundle.bossAttempts ?? []) tx.objectStore('bossAttempts').add(a)
    } catch (e) {
      // 同步写入失败（如 DataCloneError）：中止事务，回滚已排队的 clear
      try {
        tx.abort()
      } catch {
        /* 事务已结束 */
      }
      return finished.then(
        () => {
          throw e
        },
        () => {
          throw e
        },
      )
    }
    return finished
  }
}

/**
 * 打开 IndexedDB 仓库。版本高于本程序、缺仓库、Profile 结构不对时抛
 * StorageCorruptError（带原始数据）——绝不静默清空（主 spec §10.3）。
 */
export async function openIndexedDbRepository(
  opts: { name?: string; attemptCap?: number; factory?: IDBFactory } = {},
): Promise<Repository> {
  const factory = opts.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!factory) throw new StorageUnavailableError('此环境没有 IndexedDB')
  const name = opts.name ?? DB_NAME
  let db: IDBDatabase
  try {
    db = await open(factory, name, SCHEMA_VERSION)
  } catch (e) {
    // 仅「版本高于本程序」算数据问题；其余（隐私模式、被占用、配额等）视为存储不可用，由运行时降级到内存
    if ((e as { name?: string } | null)?.name === 'VersionError') {
      throw new StorageCorruptError(`无法打开本地数据库：${String(e)}`, await rawDump(factory, name))
    }
    throw new StorageUnavailableError(`本地数据库不可用：${String(e)}`)
  }
  const missing = STORES.filter((s) => !db.objectStoreNames.contains(s))
  if (missing.length > 0) {
    db.close()
    throw new StorageCorruptError(`本地数据库缺少仓库：${missing.join('、')}`, await rawDump(factory, name))
  }
  const repo = new IndexedDbRepository(db, opts.attemptCap ?? ATTEMPT_CAP)
  let profile: unknown
  try {
    profile = await req(db.transaction('profile', 'readonly').objectStore('profile').get(PROFILE_KEY))
  } catch (e) {
    db.close()
    throw e
  }
  if (profile !== undefined && !isProfile(profile)) {
    db.close()
    throw new StorageCorruptError('本地数据库里的 Profile 结构不对', await rawDump(factory, name))
  }
  return repo
}

/** 删除整个数据库（损坏后用户确认重建时用）。其他标签页占用时 reject */
export function deleteIndexedDb(opts: { name?: string; factory?: IDBFactory } = {}): Promise<void> {
  const factory = opts.factory ?? globalThis.indexedDB
  const name = opts.name ?? DB_NAME
  return new Promise((resolve, reject) => {
    if (!factory) {
      resolve()
      return
    }
    const r = factory.deleteDatabase(name)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error('另一个标签页正在使用本地数据库，请关闭其他标签页后重试'))
  })
}
