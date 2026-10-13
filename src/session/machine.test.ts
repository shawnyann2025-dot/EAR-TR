import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { masteryKey } from '../curriculum/knowledgePoints'
import { answerAsResponse } from '../exercises/generate'
import type { MasteryState } from '../scheduling/mastery'
import { buildSessionPlan } from '../scheduling/scheduler'
import { createSession, reduce, resumeSession, toRecord } from './machine'
import { SESSION_MINUTES, type ReduceContext, type SessionEffect, type SessionState } from './types'

const c = buildCurriculum()
const ctx = (mastery = new Map<string, MasteryState>()): ReduceContext => ({ curriculum: c, mastery, nowIso: '2026-10-13T08:00:00.000Z' })

function freshSession(): SessionState {
  const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 0, seed: 11, minutes: SESSION_MINUTES })
  return createSession({ mode: 'session', day: 0, sessionNo: 0, phaseId: 'P1', plan })
}
const types = (effects: SessionEffect[]) => effects.map((e) => e.type)

describe('出题', () => {
  it('play 副作用带上题目内容起点', () => {
    const r = reduce(freshSession(), { type: 'start' }, ctx())
    const play = r.effects[0]
    if (play.type !== 'play') throw new Error('应先 play')
    expect(play.contentStartSec).toBe(r.state.current!.exercise.contentStartSec)
  })

  it('start：出第一道计划题并播放，进入 presenting', () => {
    const s0 = freshSession()
    const r = reduce(s0, { type: 'start' }, ctx())
    expect(r.state.phase).toBe('presenting')
    expect(r.state.current?.planIndex).toBe(0)
    expect(types(r.effects)).toEqual(['play'])
  })

  it('contentPlayed：presenting → answering', () => {
    const r1 = reduce(freshSession(), { type: 'start' }, ctx())
    const r2 = reduce(r1.state, { type: 'contentPlayed' }, ctx())
    expect(r2.state.phase).toBe('answering')
    expect(r2.effects).toEqual([])
  })
})

describe('热身题不计分', () => {
  it('作答后不写作答、不写掌握度，只写会话进度；index +1', () => {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    expect(s.current?.spec.segment).toBe('warmup')
    expect(s.current?.scored).toBe(false)
    s = reduce(s, { type: 'contentPlayed' }, ctx()).state
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 900 }, ctx())
    expect(types(r.effects)).toEqual(['saveSession'])
    expect(r.state.index).toBe(1)
    expect(r.state.progress).toEqual({ attempted: 0, correct: 0 })
    expect(r.state.phase).toBe('feedback')
  })
})

describe('计分题', () => {
  /** 推进到第一道计分题的 answering 状态 */
  function atFirstScored(): SessionState {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    while (!s.current!.scored) {
      s = reduce(s, { type: 'contentPlayed' }, ctx()).state
      s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 }, ctx()).state
      s = reduce(s, { type: 'next' }, ctx()).state
    }
    return reduce(s, { type: 'contentPlayed' }, ctx()).state
  }

  it('规格里写入了阶梯档位；作答写作答、写掌握度、写会话进度', () => {
    const s = atFirstScored()
    expect(s.current!.spec.difficultyStep).toBe(s.current!.ladder!.step)
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1200 }, ctx())
    expect(types(r.effects)).toEqual(['saveAttempt', 'saveMastery', 'saveSession'])
    const attempt = r.effects[0]
    if (attempt.type !== 'saveAttempt') throw new Error('副作用顺序错')
    expect(attempt.attempt).toMatchObject({ day: 0, sessionNo: 0, correct: true, latencyMs: 1200, at: '2026-10-13T08:00:00.000Z' })
    expect(attempt.attempt.spec).toEqual(s.current!.spec)
    const mastery = r.effects[1]
    if (mastery.type !== 'saveMastery') throw new Error('副作用顺序错')
    expect(mastery.key).toBe(masteryKey(s.current!.spec.kpId, s.current!.spec.modality))
    expect(mastery.state.window).toHaveLength(1)
    expect(r.state.progress).toEqual({ attempted: 1, correct: 1 })
    expect(r.state.byTrack[s.current!.spec.track]).toBe(1)
    expect(r.state.ladders[mastery.key]).toBeDefined()
  })

  it('答错的实时规格进入 wrongThisSession', () => {
    const s = atFirstScored()
    const ans = s.current!.exercise.answer
    const wrong =
      ans.kind === 'choice' ? { kind: 'choice' as const, id: '__wrong__' }
      : ans.kind === 'sequence' ? { kind: 'sequence' as const, ids: [] }
      : ans.kind === 'pitch' ? { kind: 'pitch' as const, selfAssessedCorrect: false }
      : { kind: 'tap' as const, tapsSec: [] }
    const r = reduce(s, { type: 'answer', response: wrong, latencyMs: 800 }, ctx())
    expect(r.state.lastGrade?.correct).toBe(false)
    expect(r.state.wrongThisSession).toEqual([s.current!.spec])
  })
})

describe('中断', () => {
  it('answering 时中断：停播，不写任何东西，回到 idle，index 不变；恢复后重出同一道题', () => {
    const r1 = reduce(freshSession(), { type: 'start' }, ctx())
    const s1 = reduce(r1.state, { type: 'contentPlayed' }, ctx()).state
    const r2 = reduce(s1, { type: 'interrupted' }, ctx())
    expect(types(r2.effects)).toEqual(['stopAudio'])
    expect(r2.state.phase).toBe('idle')
    expect(r2.state.current).toBeNull()
    expect(r2.state.index).toBe(s1.index)
    const r3 = reduce(r2.state, { type: 'start' }, ctx())
    expect(r3.state.current?.exercise).toEqual(r1.state.current?.exercise)
  })

  it('feedback 或 idle 时中断：无事发生', () => {
    const s = freshSession()
    expect(reduce(s, { type: 'interrupted' }, ctx()).effects).toEqual([])
  })
})

describe('记录与续起', () => {
  it('toRecord / resumeSession 往返保留进度；续起后处于 idle', () => {
    let s = reduce(freshSession(), { type: 'start' }, ctx()).state
    s = reduce(s, { type: 'contentPlayed' }, ctx()).state
    s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx()).state
    const record = toRecord(s)
    expect(record.completed).toBe(false)
    const resumed = resumeSession(record)
    expect(resumed.index).toBe(s.index)
    expect(resumed.progress).toEqual(s.progress)
    expect(resumed.phase).toBe('idle')
    expect(resumed.current).toBeNull()
  })
})

describe('出题抛错不让会话崩掉', () => {
  it('未知知识点：发 itemError，跳到下一道', () => {
    const s0 = freshSession()
    const broken = {
      ...s0,
      plan: { ...s0.plan, items: [{ ...s0.plan.items[0], kpId: 'degree:major:nope', segment: 'focus' as const }, ...s0.plan.items.slice(1)] },
    }
    const r = reduce(broken, { type: 'start' }, ctx())
    expect(types(r.effects)).toEqual(['itemError', 'play'])
    expect(r.state.current?.planIndex).toBe(1)
  })
})

describe('计划用完', () => {
  it('空计划：start 后直接结束，写会话完成并发 ended', () => {
    const s0 = { ...freshSession(), plan: { ...freshSession().plan, items: [] } }
    const r = reduce(s0, { type: 'start' }, ctx())
    expect(r.state.phase).toBe('done')
    expect(types(r.effects)).toContain('ended')
    const save = r.effects.find((e) => e.type === 'saveSession')
    if (!save || save.type !== 'saveSession') throw new Error('缺 saveSession')
    expect(save.record.completed).toBe(true)
  })
})

describe('实战关计数与作答延迟', () => {
  function wrongFor(s: SessionState) {
    const ans = s.current!.exercise.answer
    return ans.kind === 'choice' ? { kind: 'choice' as const, id: '__wrong__' }
      : ans.kind === 'sequence' ? { kind: 'sequence' as const, ids: [] }
      : ans.kind === 'pitch' ? { kind: 'pitch' as const, selfAssessedCorrect: false }
      : { kind: 'tap' as const, tapsSec: [] }
  }
  /** 真实计划里取一道计分题，再造 2 道同规格的实战关题（segment 改为 boss），组成手工计划 */
  function bossSession(): SessionState {
    const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 0, seed: 11, minutes: SESSION_MINUTES })
    const other = plan.items.find((i) => i.segment !== 'boss' && i.segment !== 'warmup')!
    const boss = { ...other, segment: 'boss' as const }
    return createSession({ mode: 'session', day: 0, sessionNo: 0, phaseId: 'P1', plan: { ...plan, items: [other, boss, boss] } })
  }
  const toAnswering = (s: SessionState, ev: 'start' | 'next') => reduce(reduce(s, { type: ev }, ctx()).state, { type: 'contentPlayed' }, ctx()).state

  it('实战关题计入 boss；非实战关计分题不动 boss', () => {
    let s = toAnswering(bossSession(), 'start')
    expect(s.current!.scored).toBe(true)
    s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 100 }, ctx()).state
    expect(s.progress.attempted).toBe(1)
    expect(s.boss).toEqual({ attempted: 0, correct: 0 })

    s = toAnswering(s, 'next')
    expect(s.current!.spec.segment).toBe('boss')
    s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 100 }, ctx()).state
    expect(s.boss).toEqual({ attempted: 1, correct: 1 })

    s = toAnswering(s, 'next')
    expect(s.current!.spec.segment).toBe('boss')
    const r = reduce(s, { type: 'answer', response: wrongFor(s), latencyMs: 100 }, ctx())
    expect(r.state.boss).toEqual({ attempted: 2, correct: 1 })
    const saved = r.effects.find((e) => e.type === 'saveSession')
    expect(saved && saved.type === 'saveSession' && saved.record.boss).toEqual({ attempted: 2, correct: 1 })
  })

  it('latencyMs 非有限或为负时记为 0', () => {
    const answerWith = (latencyMs: number) => {
      const s = toAnswering(bossSession(), 'start')
      const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs }, ctx())
      const e = r.effects.find((x) => x.type === 'saveAttempt')
      if (!e || e.type !== 'saveAttempt') throw new Error('no attempt')
      return e.attempt.latencyMs
    }
    expect(answerWith(NaN)).toBe(0)
    expect(answerWith(Infinity)).toBe(0)
    expect(answerWith(-5)).toBe(0)
    expect(answerWith(742)).toBe(742)
  })
})
