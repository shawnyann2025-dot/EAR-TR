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

  it('版本号 0 / 非整数 / 缺 exportedAt / profile 类型错', () => {
    expect(() => parseBundle(JSON.stringify({ ...valid(), schemaVersion: 0 }))).toThrow(StorageImportError)
    expect(() => parseBundle(JSON.stringify({ ...valid(), schemaVersion: 1.5 }))).toThrow(StorageImportError)
    const { exportedAt: _e, ...noExp } = valid()
    expect(() => parseBundle(JSON.stringify(noExp))).toThrow(StorageImportError)
    expect(() => parseBundle(JSON.stringify({ ...valid(), profile: 'x' }))).toThrow(StorageImportError)
  })

  const bad = (patch: Record<string, unknown>) => () => parseBundle(JSON.stringify({ ...valid(), ...patch }))
  const goodProfile = () => ({ ...valid().profile }) as Record<string, unknown>
  const goodMastery = (): Record<string, unknown> => ({ stability: 1, difficulty: 0.3, variationLevel: 0, contextLevel: 0, window: [], lastSeenDay: null })
  const goodAttempt = () => ({ kpId: 'k', modality: 'recognize', spec: {}, correct: true, day: 0, sessionNo: 0, latencyMs: 1 })
  const goodSession = () => ({ day: 0, sessionNo: 0, index: 0, plan: { items: [] }, completed: false })

  it('正常的元素通过', () => {
    const b = {
      ...valid(), mastery: [['k@m', goodMastery()]], attempts: [goodAttempt()], sessions: [goodSession()],
      gates: [{ phaseId: 'P1', passedOnDay: 3 }], attemptAggregates: [{ key: 'k@m', attempts: 1, correct: 1 }],
    }
    expect(() => parseBundle(JSON.stringify(b))).not.toThrow()
  })

  it('profile 缺字段或类型错', () => {
    for (const f of ['id', 'createdAtLocalDate', 'phaseId', 'displayScheme', 'placement', 'schemaVersion']) {
      const p = goodProfile()
      delete p[f]
      expect(bad({ profile: p }), f).toThrow(StorageImportError)
    }
    expect(bad({ profile: { ...goodProfile(), id: 1 } })).toThrow(StorageImportError)
    expect(bad({ profile: {} })).toThrow(StorageImportError)
  })

  it('mastery 状态缺字段或类型错', () => {
    for (const f of ['stability', 'difficulty', 'variationLevel', 'contextLevel', 'window', 'lastSeenDay']) {
      const m = goodMastery()
      delete m[f]
      expect(bad({ mastery: [['k@m', m]] }), f).toThrow(StorageImportError)
    }
    expect(bad({ mastery: [['k@m', { ...goodMastery(), window: {} }]] })).toThrow(StorageImportError)
    expect(bad({ mastery: [['k@m', { ...goodMastery(), lastSeenDay: 'x' }]] })).toThrow(StorageImportError)
  })

  it('attempt 元素非法', () => {
    expect(bad({ attempts: [null] })).toThrow(StorageImportError)
    expect(bad({ attempts: [{ ...goodAttempt(), kpId: 1 }] })).toThrow(StorageImportError)
    expect(bad({ attempts: [{ ...goodAttempt(), spec: 'x' }] })).toThrow(StorageImportError)
    expect(bad({ attempts: [{ ...goodAttempt(), correct: 1 }] })).toThrow(StorageImportError)
    expect(bad({ attempts: [{ ...goodAttempt(), latencyMs: 'x' }] })).toThrow(StorageImportError)
  })

  it('session 元素非法', () => {
    expect(bad({ sessions: [{}] })).toThrow(StorageImportError)
    expect(bad({ sessions: [{ ...goodSession(), index: 'x' }] })).toThrow(StorageImportError)
    expect(bad({ sessions: [{ ...goodSession(), plan: { items: {} } }] })).toThrow(StorageImportError)
    expect(bad({ sessions: [{ ...goodSession(), completed: 0 }] })).toThrow(StorageImportError)
  })

  it('gate / aggregate 元素非法', () => {
    expect(bad({ gates: [1] })).toThrow(StorageImportError)
    expect(bad({ gates: [{ phaseId: 'P1' }] })).toThrow(StorageImportError)
    expect(bad({ attemptAggregates: ['x'] })).toThrow(StorageImportError)
    expect(bad({ attemptAggregates: [{ key: 'k', attempts: 1 }] })).toThrow(StorageImportError)
  })
})
