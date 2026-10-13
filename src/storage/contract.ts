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

    it('导入整体替换旧数据', async () => {
      const a = await make({})
      await a.putMastery(masteryKey('degree:major:re', 'notate'), initialMastery())
      const empty = await (await make({})).exportAll('x')
      await a.importAll(empty)
      expect((await a.loadMastery()).size).toBe(0)
    })
  })
}
