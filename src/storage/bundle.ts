import { SCHEMA_VERSION, StorageImportError, type ExportBundle } from './types'

/** 迁移表：MIGRATIONS[v] 把 v 版导出包升到 v+1。v1 时为空 */
export const MIGRATIONS: Record<number, (b: ExportBundle) => ExportBundle> = {}

const isArray = (x: unknown): x is unknown[] => Array.isArray(x)
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

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
  if (typeof raw.exportedAt !== 'string') throw new StorageImportError('导出包缺少 exportedAt')
  if (raw.profile !== null && !isObj(raw.profile)) throw new StorageImportError('导出包 profile 类型错误')
  for (const pair of raw.mastery as unknown[]) {
    if (!isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !isObj(pair[1])) {
      throw new StorageImportError('导出包 mastery 条目结构不对')
    }
  }
  let bundle = raw as unknown as ExportBundle
  for (let ver = v; ver < SCHEMA_VERSION; ver++) {
    const step = MIGRATIONS[ver]
    if (!step) throw new StorageImportError(`缺少从版本 ${ver} 升级的迁移`)
    bundle = step(bundle)
  }
  return { ...bundle, schemaVersion: SCHEMA_VERSION }
}
