import { SCHEMA_VERSION, StorageImportError, type ExportBundle } from './types'

/** 迁移表：MIGRATIONS[v] 把 v 版导出包升到 v+1 */
export const MIGRATIONS: Record<number, (b: ExportBundle) => ExportBundle> = {
  /** v1 → v2：新增实战关尝试（P-5b） */
  1: (b) => ({ ...b, bossAttempts: [] }),
}

const isArray = (x: unknown): x is unknown[] => Array.isArray(x)
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

function validProfile(p: unknown): boolean {
  if (!isObj(p)) return false
  const pl = p.placement
  const base =
    isStr(p.id) && isStr(p.createdAtLocalDate) && isStr(p.phaseId) && isStr(p.displayScheme) &&
    isNum(p.schemaVersion) && isObj(pl) && typeof pl.done === 'boolean' && (pl.startPhase === null || isStr(pl.startPhase))
  if (!base) return false
  const vr = p.vocalRange
  if (vr !== undefined && vr !== null && !(isObj(vr) && isNum(vr.lowMidi) && isNum(vr.highMidi))) return false
  const sm = p.singMode
  if (sm !== undefined && sm !== 'detect' && sm !== 'self') return false
  const fr = p.micFallbackReason
  if (fr !== undefined && fr !== 'denied' && fr !== 'unsupported') return false
  return true
}
function validMasteryPair(pair: unknown): boolean {
  if (!isArray(pair) || pair.length !== 2 || !isStr(pair[0]) || !isObj(pair[1])) return false
  const m = pair[1]
  return (
    isNum(m.stability) && isNum(m.difficulty) && isNum(m.variationLevel) && isNum(m.contextLevel) &&
    isArray(m.window) && (m.lastSeenDay === null || isNum(m.lastSeenDay))
  )
}
function validAttempt(a: unknown): boolean {
  return (
    isObj(a) && isStr(a.kpId) && isStr(a.modality) && isObj(a.spec) && typeof a.correct === 'boolean' &&
    isNum(a.day) && isNum(a.sessionNo) && isNum(a.latencyMs)
  )
}
function validSession(s: unknown): boolean {
  return (
    isObj(s) && isNum(s.day) && isNum(s.sessionNo) && isNum(s.index) && isObj(s.plan) && isArray(s.plan.items) &&
    typeof s.completed === 'boolean'
  )
}
function validGate(g: unknown): boolean {
  return isObj(g) && isStr(g.phaseId) && isNum(g.passedOnDay)
}
function validBossAttempt(a: unknown): boolean {
  return (
    isObj(a) && isStr(a.phaseId) && isNum(a.day) && isNum(a.seed) && isObj(a.parts) &&
    Object.values(a.parts).every(isNum) && typeof a.passed === 'boolean' && isStr(a.at)
  )
}
function validAggregate(a: unknown): boolean {
  return isObj(a) && isStr(a.key) && isNum(a.attempts) && isNum(a.correct)
}

/** 校验 + 迁移。失败一律抛 StorageImportError，不产生部分结果 */
export function parseBundle(json: string): ExportBundle {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new StorageImportError('不是合法的 JSON 文件')
  }
  if (!isObj(raw)) throw new StorageImportError('导出包结构不对')
  const v = raw.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new StorageImportError('导出包缺少版本号')
  if (v > SCHEMA_VERSION) throw new StorageImportError(`导出包版本 ${v} 高于本程序支持的 ${SCHEMA_VERSION}`)
  for (const field of ['mastery', 'attempts', 'attemptAggregates', 'sessions', 'gates'] as const) {
    if (!isArray(raw[field])) throw new StorageImportError(`导出包字段 ${field} 缺失或类型错误`)
  }
  if (v >= 2 && !isArray(raw.bossAttempts)) throw new StorageImportError('导出包字段 bossAttempts 缺失或类型错误')
  if (typeof raw.exportedAt !== 'string') throw new StorageImportError('导出包缺少 exportedAt')
  if (raw.profile !== null && !validProfile(raw.profile)) throw new StorageImportError('导出包 profile 结构不对')
  const checks: [string, unknown[], (x: unknown) => boolean][] = [
    ['mastery', raw.mastery as unknown[], validMasteryPair],
    ['attempts', raw.attempts as unknown[], validAttempt],
    ['attemptAggregates', raw.attemptAggregates as unknown[], validAggregate],
    ['sessions', raw.sessions as unknown[], validSession],
    ['gates', raw.gates as unknown[], validGate],
  ]
  for (const [field, items, ok] of checks) {
    if (!items.every(ok)) throw new StorageImportError(`导出包 ${field} 条目结构不对`)
  }
  let bundle = raw as unknown as ExportBundle
  for (let ver = v; ver < SCHEMA_VERSION; ver++) {
    const step = MIGRATIONS[ver]
    if (!step) throw new StorageImportError(`缺少从版本 ${ver} 升级的迁移`)
    bundle = step(bundle)
  }
  if (!bundle.bossAttempts.every(validBossAttempt)) throw new StorageImportError('导出包 bossAttempts 条目结构不对')
  return { ...bundle, schemaVersion: SCHEMA_VERSION }
}
