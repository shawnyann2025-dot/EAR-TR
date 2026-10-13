import { masteryKey, type MasteryKey, type Track } from '../curriculum/knowledgePoints'
import type { PhaseId } from '../curriculum/stages'
import { generate, grade } from '../exercises/generate'
import { evaluateGate, nextPhase } from '../scheduling/gate'
import type { MasteryState } from '../scheduling/mastery'
import type { SessionPlan } from '../scheduling/scheduler'
import { prepareItem, recordAnswer, stagnationUpdates } from './item'
import {
  BOSS_STANDIN_ACCURACY,
  CurrentItem,
  ReduceContext,
  ReduceResult,
  SessionEffect,
  SessionEvent,
  SessionMode,
  SessionRecord,
  SessionState,
  SessionSummary,
  Tally,
} from './types'

const zeroByTrack = (): Record<Track, number> => ({ T: 0, H: 0, R: 0 })

export function createSession(input: {
  mode: SessionMode
  day: number
  sessionNo: number
  phaseId: PhaseId
  plan: SessionPlan
}): SessionState {
  return {
    ...input,
    index: 0,
    ladders: {},
    progress: { attempted: 0, correct: 0 },
    boss: { attempted: 0, correct: 0 },
    byTrack: zeroByTrack(),
    reliefTriggered: false,
    phase: 'idle',
    current: null,
    lastGrade: null,
    wrongThisSession: [],
    summary: null,
  }
}

/** 从会话记录续起。阶梯不落盘：续起后由掌握度窗口推导（P-3 spec §4.1） */
export function resumeSession(record: SessionRecord): SessionState {
  return {
    ...createSession({ mode: 'session', day: record.day, sessionNo: record.sessionNo, phaseId: record.phaseId, plan: record.plan }),
    index: record.index,
    progress: { ...record.progress },
    boss: { ...record.boss },
    byTrack: { ...record.byTrack },
    reliefTriggered: record.reliefTriggered,
  }
}

export function toRecord(state: SessionState): SessionRecord {
  return {
    day: state.day,
    sessionNo: state.sessionNo,
    phaseId: state.phaseId,
    plan: state.plan,
    index: state.index,
    progress: { ...state.progress },
    boss: { ...state.boss },
    byTrack: { ...state.byTrack },
    reliefTriggered: state.reliefTriggered,
    completed: state.phase === 'done',
  }
}

const persists = (state: SessionState) => state.mode === 'session'

/** 出第 index 道计划题；出题抛错则发 itemError 并跳到下一道；计划用完则结束 */
function present(state: SessionState, ctx: ReduceContext, effects: SessionEffect[]): ReduceResult {
  let s = state
  while (s.index < s.plan.items.length) {
    const planned = s.plan.items[s.index]
    const scored = s.mode === 'session' && planned.segment !== 'warmup'
    let current: CurrentItem
    let reliefTriggered = s.reliefTriggered
    try {
      if (scored) {
        const key = masteryKey(planned.kpId, planned.modality)
        const prepared = prepareItem(planned, s.ladders[key], ctx.mastery, s.progress)
        reliefTriggered = reliefTriggered || prepared.relief
        current = { planIndex: s.index, spec: prepared.spec, exercise: generate(prepared.spec, ctx.curriculum), scored, ladder: prepared.ladder }
      } else {
        // 热身题与重练题：规格原样出题，不碰阶梯
        current = { planIndex: s.index, spec: planned, exercise: generate(planned, ctx.curriculum), scored: false, ladder: null }
      }
    } catch (e) {
      effects.push({ type: 'itemError', spec: planned, message: (e as Error).message })
      s = { ...s, index: s.index + 1 }
      continue
    }
    return {
      state: { ...s, reliefTriggered, phase: 'presenting', current, lastGrade: null },
      effects: [...effects, { type: 'play', plan: current.exercise.plan }],
    }
  }
  return finish(s, ctx, effects, true)
}

/** 实战关替身（P-3 spec D3）：本场实战关段至少答过 1 题，且正确率达标 */
export function bossPassed(boss: Tally): boolean {
  return boss.attempted > 0 && boss.correct / boss.attempted >= BOSS_STANDIN_ACCURACY
}

/**
 * 结束流程（P-3 spec §3.7）。
 * full = 计划用完；endEarly 时为 false——不完整的会话不评估关卡、不升阶段。
 */
function finish(state: SessionState, ctx: ReduceContext, effects: SessionEffect[], full: boolean): ReduceResult {
  const out = [...effects]
  const summary = baseSummary(state)

  if (persists(state)) {
    // ① 跨天护栏：停滞的 key 拆解后写回；关卡评估用合并后的掌握度
    const merged = new Map<MasteryKey, MasteryState>(ctx.mastery)
    for (const u of stagnationUpdates(ctx.curriculum, state.phaseId, state.day, ctx.mastery)) {
      merged.set(u.key, u.state)
      out.push({ type: 'saveMastery', key: u.key, state: u.state })
    }

    // ② 关卡：三模态齐平 + 实战关替身
    if (full) {
      const boss = bossPassed(state.boss)
      const gate = evaluateGate(ctx.curriculum, merged, state.phaseId, boss)
      const to = gate.passed ? nextPhase(state.phaseId) : null
      if (to) out.push({ type: 'advancePhase', from: state.phaseId, to, day: state.day })
      summary.gate = {
        evaluated: true,
        passed: gate.passed,
        blockingKeys: gate.blockingKeys.length,
        bossSatisfied: gate.bossSatisfied,
        advancedTo: to,
      }
    }
  }

  const done: SessionState = { ...state, phase: 'done', current: null, summary }
  if (persists(state)) out.push({ type: 'saveSession', record: toRecord(done) })
  out.push({ type: 'ended', summary })
  return { state: done, effects: out }
}

function baseSummary(state: SessionState): SessionSummary {
  const { attempted, correct } = state.progress
  return {
    scored: attempted,
    correct,
    accuracy: attempted > 0 ? correct / attempted : 0,
    byTrack: { ...state.byTrack },
    reliefTriggered: state.reliefTriggered,
    gate: { evaluated: false, passed: false, blockingKeys: 0, bossSatisfied: false, advancedTo: null },
  }
}

function answer(
  state: SessionState,
  event: Extract<SessionEvent, { type: 'answer' }>,
  ctx: ReduceContext,
): ReduceResult {
  const cur = state.current
  if (state.phase !== 'answering' || !cur) return { state, effects: [] }
  const result = grade(cur.exercise, event.response)
  let s: SessionState = { ...state, index: state.index + 1, phase: 'feedback', lastGrade: result }
  const effects: SessionEffect[] = []

  if (cur.scored && cur.ladder) {
    const recorded = recordAnswer({
      curriculum: ctx.curriculum,
      phaseId: s.phaseId,
      day: s.day,
      mastery: ctx.mastery,
      spec: cur.spec,
      ladder: cur.ladder,
      correct: result.correct,
    })
    const isBoss = cur.spec.segment === 'boss'
    s = {
      ...s,
      ladders: { ...s.ladders, [recorded.key]: recorded.ladder },
      progress: { attempted: s.progress.attempted + 1, correct: s.progress.correct + (result.correct ? 1 : 0) },
      boss: isBoss ? { attempted: s.boss.attempted + 1, correct: s.boss.correct + (result.correct ? 1 : 0) } : s.boss,
      byTrack: { ...s.byTrack, [cur.spec.track]: s.byTrack[cur.spec.track] + 1 },
      wrongThisSession: result.correct ? s.wrongThisSession : [...s.wrongThisSession, cur.spec],
    }
    effects.push({
      type: 'saveAttempt',
      attempt: {
        at: ctx.nowIso,
        day: s.day,
        sessionNo: s.sessionNo,
        kpId: cur.spec.kpId,
        modality: cur.spec.modality,
        spec: cur.spec,
        correct: result.correct,
        latencyMs: event.latencyMs,
        detail: result.detail,
      },
    })
    effects.push({ type: 'saveMastery', key: recorded.key, state: recorded.state })
  }
  if (persists(s)) effects.push({ type: 'saveSession', record: toRecord(s) })
  return { state: s, effects }
}

export function reduce(state: SessionState, event: SessionEvent, ctx: ReduceContext): ReduceResult {
  switch (event.type) {
    case 'start':
    case 'next':
      if (state.phase !== 'idle' && state.phase !== 'feedback') return { state, effects: [] }
      return present(state, ctx, [])
    case 'contentPlayed':
      if (state.phase !== 'presenting') return { state, effects: [] }
      return { state: { ...state, phase: 'answering' }, effects: [] }
    case 'answer':
      return answer(state, event, ctx)
    case 'interrupted':
      // 当前题作废：不写作答、不改阶梯与计数；index 未动，恢复后重出同一道（主 spec §11）
      if (state.phase !== 'presenting' && state.phase !== 'answering') return { state, effects: [] }
      return { state: { ...state, phase: 'idle', current: null }, effects: [{ type: 'stopAudio' }] }
    case 'endEarly':
      if (state.phase === 'done') return { state, effects: [] }
      return finish(state, ctx, state.phase === 'presenting' || state.phase === 'answering' ? [{ type: 'stopAudio' }] : [], false)
  }
}

/** 重练换新 seed：同一规格、不同题面 */
export const DRILL_SEED_SALT = 0x9e3779b9

/**
 * 重练刚才错的这组（主 spec §6.5）：不写作答、不写掌握度、不动阶梯，只做即时巩固。
 * 计划由本场错题的实时规格组成；没有错题时返回 null。
 */
export function createDrill(from: SessionState): SessionState | null {
  if (from.wrongThisSession.length === 0) return null
  const items = from.wrongThisSession.map((spec) => ({ ...spec, seed: (spec.seed ^ DRILL_SEED_SALT) >>> 0 }))
  return createSession({
    mode: 'drill',
    day: from.day,
    sessionNo: from.sessionNo,
    phaseId: from.phaseId,
    plan: { day: from.day, seed: from.plan.seed, phaseId: from.phaseId, items },
  })
}
