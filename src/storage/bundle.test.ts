import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, StorageImportError, type ExportBundle } from './types'
import { parseBundle } from './bundle'

const valid = (): ExportBundle => ({
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-10-13T00:00:00.000Z',
  profile: { id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: false, startPhase: null }, schemaVersion: SCHEMA_VERSION },
  mastery: [],
  attempts: [],
  attemptAggregates: [],
  sessions: [],
  gates: [],
})

describe('parseBundle', () => {
  it('合法导出包往返', () => {
    expect(parseBundle(JSON.stringify(valid()))).toEqual(valid())
  })
  it('不是 JSON / 缺字段 / 字段类型错：抛 StorageImportError', () => {
    expect(() => parseBundle('nope')).toThrow(StorageImportError)
    const { attempts: _a, ...missing } = valid()
    expect(() => parseBundle(JSON.stringify(missing))).toThrow(StorageImportError)
    expect(() => parseBundle(JSON.stringify({ ...valid(), mastery: 'x' }))).toThrow(StorageImportError)
  })
  it('版本高于本程序：抛 StorageImportError', () => {
    expect(() => parseBundle(JSON.stringify({ ...valid(), schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(/版本/)
  })
})
