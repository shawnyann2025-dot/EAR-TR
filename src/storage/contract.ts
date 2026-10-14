import { describe, expect, it } from 'vitest'
import { masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery } from '../scheduling/mastery'
import type { AttemptRecord, SessionRecord } from '../session/types'
import { SCHEMA_VERSION, type Profile, type Repository } from './types'

const profile = (): Profile => ({
  id: 'p1', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege',
  placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION,
})
const attempt = (i: number, kpId = 'degree:major:do', correct = true): AttemptRecord => ({
  at: `2026-10-13T00:00:${String(i % 60).padStart(2, '0')}.000Z`, day: 0, sessionNo: 0, kpId, modality: 'recognize',
  spec: { kpId, modality: 'recognize', track: 'T', contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed: i, segment: 'focus' },
  correct, latencyMs: 100, detail: { kind: 'choice' },
})
const session = (day: number, sessionNo: number, completed = false): SessionRecord => ({
  day, sessionNo, phaseId: 'P1', plan: { day, seed: 1, phaseId: 'P1', items: [] }, index: 3,
  progress: { attempted: 2, correct: 1 }, boss: { attempted: 0, correct: 0 }, byTrack: { T: 1, H: 1, R: 0 },
  reliefTriggered: false, completed,
})

/** 两个 Repository 实现共用的契约（P-3 spec §8） */
export function repositoryContract(
  name: string,
  make: (opts: { attemptCap?: number }) => Promise<Repository>,
): void {
  describe(`Repository 契约：${name}`, () => {
    it('空库：没有 Profile、掌握度为空、没有会话', async () => {
      const r = await make({})
      expect(await r.loadProfile()).toBeNull()
      expect((await r.loadMastery()).size).toBe(0)
      expect(await r.loadSession(0, 0)).toBeNull()
      expect(await r.latestSessionNo(0)).toBeNull()
      expect(await r.countAttempts()).toBe(0)
    })

    it('Profile、掌握度、会话读写往返', async () => {
      const r = await make({})
      await r.saveProfile(profile())
      expect(await r.loadProfile()).toEqual(profile())
      const k = masteryKey('degree:major:do', 'sing')
      const s = { ...initialMastery(), stability: 3.5 }
      await r.putMastery(k, s)
      expect((await r.loadMastery()).get(k)).toEqual(s)
      await r.putSession(session(2, 0))
      await r.putSession(session(2, 1, true))
      expect(await r.loadSession(2, 1)).toEqual(session(2, 1, true))
      expect(await r.latestSessionNo(2)).toBe(1)
      await r.putSession({ ...session(2, 0), index: 9 })
      expect((await r.loadSession(2, 0))?.index).toBe(9)
    })

    it('作答追加与计数；超出上限时最旧的归档为聚合', async () => {
      const r = await make({ attemptCap: 3 })
      for (let i = 0; i < 5; i++) await r.appendAttempt(attempt(i, 'degree:major:do', i % 2 === 0))
      expect(await r.countAttempts()).toBe(3)
      const b = await r.exportAll('x')
      expect(b.attempts.map((a) => a.spec.seed)).toEqual([2, 3, 4])
      expect(b.attemptAggregates).toEqual([{ key: masteryKey('degree:major:do', 'recognize'), attempts: 2, correct: 1 }])
    })

    it('导出 → 导入到新库：内容一致', async () => {
      const a = await make({})
      await a.saveProfile(profile())
      await a.putMastery(masteryKey('chord:I', 'recognize'), { ...initialMastery(), stability: 7 })
      await a.appendAttempt(attempt(1))
      await a.putSession(session(1, 0, true))
      await a.putGate({ phaseId: 'P1', passedOnDay: 40 })
      const bundle = await a.exportAll('2026-10-13T00:00:00.000Z')
      const b = await make({})
      await b.importAll(bundle)
      expect(await b.exportAll('2026-10-13T00:00:00.000Z')).toEqual(bundle)
    })

    it('实战关尝试：追加、按阶段过滤、按写入顺序；导出导入往返', async () => {
      const r = await make({})
      const a = (phaseId: 'P1' | 'P2', day: number, passed: boolean) => ({ phaseId, day, seed: day * 10, parts: { melody: 0.95 }, passed, at: `2026-10-14T00:00:0${day}.000Z` })
      await r.appendBossAttempt(a('P1', 1, false))
      await r.appendBossAttempt(a('P1', 2, true))
      await r.appendBossAttempt(a('P2', 3, false))
      expect((await r.listBossAttempts()).map((x) => x.day)).toEqual([1, 2, 3])
      expect((await r.listBossAttempts('P1')).map((x) => x.day)).toEqual([1, 2])
      const bundle = await r.exportAll('x')
      expect(bundle.bossAttempts).toHaveLength(3)
      const b = await make({})
      await b.importAll(bundle)
      expect(await b.listBossAttempts()).toEqual(await r.listBossAttempts())
    })

    it('导入整体替换旧数据', async () => {
      const a = await make({})
      await a.appendBossAttempt({ phaseId: 'P1', day: 1, seed: 1, parts: { melody: 1 }, passed: true, at: 'x' })
      await a.putMastery(masteryKey('degree:major:re', 'notate'), initialMastery())
      const empty = await (await make({})).exportAll('x')
      await a.importAll(empty)
      expect((await a.loadMastery()).size).toBe(0)
      expect(await a.listBossAttempts()).toEqual([])
    })

    it('latestSessionNo 与导出顺序按数值而非字符串（含跨日前缀）', async () => {
      const r = await make({})
      for (const [d, n] of [[11, 0], [1, 10], [2, 3], [1, 9]]) await r.putSession(session(d, n))
      expect(await r.latestSessionNo(1)).toBe(10)
      expect(await r.latestSessionNo(11)).toBe(0)
      expect(await r.latestSessionNo(2)).toBe(3)
      expect(await r.latestSessionNo(5)).toBeNull()
      expect((await r.exportAll('x')).sessions.map((s) => [s.day, s.sessionNo])).toEqual([[1, 9], [1, 10], [2, 3], [11, 0]])
    })

    it('多轮溢出：聚合跨轮累加，保留最新 cap 条且保持插入顺序', async () => {
      const r = await make({ attemptCap: 3 })
      const mk = (i: number, kpId: string, modality: 'recognize' | 'sing', correct: boolean): AttemptRecord => ({
        ...attempt(i, kpId, correct), modality, spec: { ...attempt(i, kpId, correct).spec, modality },
      })
      const rows = [
        mk(0, 'degree:major:do', 'recognize', true),
        mk(1, 'degree:major:do', 'sing', false),
        mk(2, 'degree:major:mi', 'recognize', true),
        mk(3, 'degree:major:do', 'recognize', false),
        mk(4, 'degree:major:mi', 'sing', true),
        mk(5, 'degree:major:do', 'recognize', true),
        mk(6, 'degree:major:mi', 'recognize', true),
      ]
      for (const a of rows) await r.appendAttempt(a)
      expect(await r.countAttempts()).toBe(3)
      const b = await r.exportAll('x')
      expect(b.attempts.map((a) => a.spec.seed)).toEqual([4, 5, 6])
      expect([...b.attemptAggregates].sort((x, y) => x.key.localeCompare(y.key))).toEqual(
        [
          { key: masteryKey('degree:major:do', 'recognize'), attempts: 2, correct: 1 },
          { key: masteryKey('degree:major:do', 'sing'), attempts: 1, correct: 0 },
          { key: masteryKey('degree:major:mi', 'recognize'), attempts: 1, correct: 1 },
        ].sort((x, y) => x.key.localeCompare(y.key)),
      )
    })

    it('putGate 是追加历史：同 phaseId 重复调用保留两条，按插入顺序', async () => {
      const r = await make({})
      await r.putGate({ phaseId: 'P1', passedOnDay: 10 })
      await r.putGate({ phaseId: 'P2', passedOnDay: 20 })
      await r.putGate({ phaseId: 'P1', passedOnDay: 30 })
      expect((await r.exportAll('x')).gates).toEqual([
        { phaseId: 'P1', passedOnDay: 10 },
        { phaseId: 'P2', passedOnDay: 20 },
        { phaseId: 'P1', passedOnDay: 30 },
      ])
    })

    it('saveProfile 与 putMastery 覆盖旧值', async () => {
      const r = await make({})
      await r.saveProfile(profile())
      await r.saveProfile({ ...profile(), phaseId: 'P2' })
      expect((await r.loadProfile())?.phaseId).toBe('P2')
      const k = masteryKey('degree:major:do', 'sing')
      await r.putMastery(k, { ...initialMastery(), stability: 2 })
      await r.putMastery(k, { ...initialMastery(), stability: 9 })
      const m = await r.loadMastery()
      expect(m.size).toBe(1)
      expect(m.get(k)?.stability).toBe(9)
    })

    it('读出的数据是副本：修改不影响仓库', async () => {
      const r = await make({})
      const k = masteryKey('degree:major:do', 'sing')
      await r.putMastery(k, { ...initialMastery(), stability: 4 })
      const m = await r.loadMastery()
      m.delete(k)
      m.set(masteryKey('x', 'sing'), initialMastery())
      const s = (await r.loadMastery()).get(k)
      expect(s?.stability).toBe(4)
      if (s) s.stability = 99
      expect((await r.loadMastery()).get(k)?.stability).toBe(4)
      await r.saveProfile(profile())
      const p = await r.loadProfile()
      if (p) p.id = 'changed'
      expect((await r.loadProfile())?.id).toBe('p1')
    })

    it('导入整体替换所有存储（档案、掌握度、作答、聚合、会话、关卡）', async () => {
      const target = await make({ attemptCap: 2 })
      await target.saveProfile(profile())
      await target.putMastery(masteryKey('degree:major:re', 'notate'), initialMastery())
      for (let i = 0; i < 4; i++) await target.appendAttempt(attempt(i, 'degree:major:re'))
      await target.putSession(session(7, 0))
      await target.putGate({ phaseId: 'P1', passedOnDay: 5 })

      const src = await make({ attemptCap: 2 })
      await src.saveProfile({ ...profile(), id: 'other', phaseId: 'P3' })
      await src.putMastery(masteryKey('chord:I', 'recognize'), { ...initialMastery(), stability: 5 })
      await src.putMastery(masteryKey('chord:V', 'sing'), { ...initialMastery(), stability: 6 })
      for (let i = 10; i < 14; i++) await src.appendAttempt(attempt(i, 'chord:I', i % 2 === 0))
      await src.putSession(session(3, 1))
      await src.putSession(session(3, 0, true))
      await src.putGate({ phaseId: 'P2', passedOnDay: 50 })
      await src.putGate({ phaseId: 'P3', passedOnDay: 90 })
      const bundle = await src.exportAll('2026-10-13T00:00:00.000Z')

      await target.importAll(bundle)
      const after = await target.exportAll('2026-10-13T00:00:00.000Z')
      expect(after).toEqual(bundle)
      expect(await target.loadSession(7, 0)).toBeNull()
      expect(await target.countAttempts()).toBe(2)
    })
  })
}
