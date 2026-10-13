import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { answerAsResponse } from '../exercises/generate'
import type { ExerciseSpec } from '../scheduling/exerciseSpec'
import { buildSessionPlan } from '../scheduling/scheduler'
import { DRILL_SEED_SALT, createDrill, createSession, reduce } from './machine'
import type { ReduceContext, SessionState } from './types'

const c = buildCurriculum()
const ctx: ReduceContext = { curriculum: c, mastery: new Map(), nowIso: 'x' }
const wrongSpec: ExerciseSpec = {
  kpId: 'degree:major:mi', modality: 'recognize', track: 'T', contextLevel: 1, variationLevel: 1, difficultyStep: 2, seed: 123, segment: 'focus',
}
const base = (): SessionState =>
  createSession({ mode: 'session', day: 3, sessionNo: 0, phaseId: 'P1', plan: { day: 3, seed: 9, phaseId: 'P1', items: [] } })

describe('createDrill（主 spec §6.5）', () => {
  it('没有错题时返回 null', () => {
    expect(createDrill(base())).toBeNull()
  })

  it('用错题的实时规格出题，seed 换新，档位与难度保持', () => {
    const d = createDrill({ ...base(), wrongThisSession: [wrongSpec] })!
    expect(d.mode).toBe('drill')
    expect(d.plan.items).toEqual([{ ...wrongSpec, seed: (123 ^ DRILL_SEED_SALT) >>> 0 }])
  })

  it('重练不产生任何持久化副作用：只有 play、无 saveAttempt / saveMastery / saveSession，结束只发 ended', () => {
    let s = createDrill({ ...base(), wrongThisSession: [wrongSpec] })!
    const seen: string[] = []
    let r = reduce(s, { type: 'start' }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    s = reduce(r.state, { type: 'contentPlayed' }, ctx).state
    r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    r = reduce(r.state, { type: 'next' }, ctx)
    seen.push(...r.effects.map((e) => e.type))
    expect(seen).toEqual(['play', 'ended'])
    expect(r.state.phase).toBe('done')
  })
})

describe('加练', () => {
  it('sessionNo 进入作答记录与会话记录', () => {
    const plan = buildSessionPlan({ curriculum: c, store: new Map(), phaseId: 'P1', today: 3, seed: 77, minutes: 25 })
    let s = createSession({ mode: 'session', day: 3, sessionNo: 1, phaseId: 'P1', plan })
    s = reduce(s, { type: 'start' }, ctx).state
    while (!s.current!.scored) {
      s = reduce(s, { type: 'contentPlayed' }, ctx).state
      s = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx).state
      s = reduce(s, { type: 'next' }, ctx).state
    }
    s = reduce(s, { type: 'contentPlayed' }, ctx).state
    const r = reduce(s, { type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 }, ctx)
    for (const e of r.effects) {
      if (e.type === 'saveAttempt') expect(e.attempt.sessionNo).toBe(1)
      if (e.type === 'saveSession') expect(e.record.sessionNo).toBe(1)
    }
  })
})
