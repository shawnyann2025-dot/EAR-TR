import type { Curriculum } from '../curriculum/curriculum'
import type { MasteryKey } from '../curriculum/knowledgePoints'
import type { PlaybackPlan } from '../music/playback'
import type { MasteryState } from '../scheduling/mastery'
import { buildSessionPlan } from '../scheduling/scheduler'
import { createDrill, createSession, reduce, resumeSession, toRecord } from '../session/machine'
import { dayIndex, sessionSeed } from '../session/time'
import { SESSION_MINUTES, type SessionEffect, type SessionEvent, type SessionState } from '../session/types'
import { SCHEMA_VERSION, type Profile, type Repository } from '../storage/types'

export interface AudioPort {
  play(plan: PlaybackPlan): { startSec: number; endSec: number }
  stopAll(): void
  readonly currentTime: number
}

export interface TimerPort {
  /** 若干秒后调用 fn；返回取消函数 */
  after(seconds: number, fn: () => void): () => void
}

export interface RuntimeDeps {
  repo: Repository
  audio: AudioPort
  timer: TimerPort
  curriculum: Curriculum
  nowIso: () => string
  todayLocalDate: () => string
  newProfileId: () => string
}

export interface RuntimeSnapshot {
  profile: Profile | null
  session: SessionState | null
  storage: 'ok' | 'readOnly'
  lastError: string | null
}

export interface Runtime {
  getSnapshot(): RuntimeSnapshot
  subscribe(fn: (s: RuntimeSnapshot) => void): () => void
  ensureProfile(): Promise<Profile>
  todayStatus(): Promise<'notStarted' | 'inProgress' | 'mainDone'>
  startToday(): Promise<void>
  startExtra(): Promise<void>
  startDrill(): Promise<void>
  dispatch(event: SessionEvent): Promise<void>
}

/** 薄壳（P-3 spec §5）：持有状态与掌握度副本，按顺序执行状态机的副作用 */
export function createRuntime(deps: RuntimeDeps): Runtime {
  const { repo, audio, timer, curriculum } = deps
  let snapshot: RuntimeSnapshot = { profile: null, session: null, storage: 'ok', lastError: null }
  let mastery = new Map<MasteryKey, MasteryState>()
  let cancelTimer: (() => void) | null = null
  const listeners = new Set<(s: RuntimeSnapshot) => void>()

  const notify = () => {
    for (const fn of listeners) fn(snapshot)
  }
  const set = (patch: Partial<RuntimeSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
  }

  /** 落盘：失败重试一次；仍失败进入只读警告，之后的写入跳过（练习不中断） */
  async function write(op: () => Promise<unknown>): Promise<void> {
    if (snapshot.storage === 'readOnly') return
    try {
      await op()
    } catch {
      try {
        await op()
      } catch (e) {
        set({ storage: 'readOnly', lastError: `进度暂时无法保存：${String((e as Error).message ?? e)}` })
      }
    }
  }

  async function ensureProfile(): Promise<Profile> {
    if (snapshot.profile) return snapshot.profile
    let p = await repo.loadProfile()
    if (!p) {
      p = {
        id: deps.newProfileId(),
        createdAtLocalDate: deps.todayLocalDate(),
        phaseId: 'P1',
        displayScheme: 'solfege',
        placement: { done: false, startPhase: null },
        schemaVersion: SCHEMA_VERSION,
      }
      await write(() => repo.saveProfile(p!))
    }
    set({ profile: p })
    return p
  }

  const today = (p: Profile) => dayIndex(p.createdAtLocalDate, deps.todayLocalDate())

  async function run(effect: SessionEffect): Promise<void> {
    switch (effect.type) {
      case 'play': {
        cancelTimer?.()
        const { endSec } = audio.play(effect.plan)
        cancelTimer = timer.after(Math.max(0, endSec - audio.currentTime), () => {
          cancelTimer = null
          void dispatch({ type: 'contentPlayed' })
        })
        return
      }
      case 'stopAudio':
        cancelTimer?.()
        cancelTimer = null
        audio.stopAll()
        return
      case 'saveMastery':
        mastery = new Map(mastery).set(effect.key, effect.state)
        return write(() => repo.putMastery(effect.key, effect.state))
      case 'saveAttempt':
        return write(() => repo.appendAttempt(effect.attempt))
      case 'saveSession':
        return write(() => repo.putSession(effect.record))
      case 'advancePhase': {
        const p = { ...(snapshot.profile ?? (await ensureProfile())), phaseId: effect.to }
        set({ profile: p })
        await write(() => repo.saveProfile(p))
        return write(() => repo.putGate({ phaseId: effect.from, passedOnDay: effect.day }))
      }
      case 'itemError':
        set({ lastError: effect.message })
        return
      case 'ended':
        return
    }
  }

  async function dispatch(event: SessionEvent): Promise<void> {
    const session = snapshot.session
    if (!session) return
    const { state, effects } = reduce(session, event, { curriculum, mastery, nowIso: deps.nowIso() })
    set({ session: state })
    for (const e of effects) await run(e)
    notify()
  }

  async function begin(state: SessionState): Promise<void> {
    mastery = await repo.loadMastery()
    set({ session: state })
    await dispatch({ type: 'start' })
  }

  async function openSession(sessionNo: number): Promise<void> {
    const p = await ensureProfile()
    const day = today(p)
    const record = await repo.loadSession(day, sessionNo)
    if (record?.completed) return
    if (record) return begin(resumeSession(record))
    const store = await repo.loadMastery()
    const plan = buildSessionPlan({
      curriculum,
      store,
      phaseId: p.phaseId,
      today: day,
      seed: sessionSeed(p.id, day, sessionNo),
      minutes: SESSION_MINUTES,
    })
    const state = createSession({ mode: 'session', day, sessionNo, phaseId: p.phaseId, plan })
    await write(() => repo.putSession(toRecord(state)))
    return begin(state)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    ensureProfile,
    async todayStatus() {
      const p = await ensureProfile()
      const r = await repo.loadSession(today(p), 0)
      return !r ? 'notStarted' : r.completed ? 'mainDone' : 'inProgress'
    },
    startToday: () => openSession(0),
    async startExtra() {
      const p = await ensureProfile()
      const day = today(p)
      const main = await repo.loadSession(day, 0)
      if (!main?.completed) return
      const latest = (await repo.latestSessionNo(day)) ?? 0
      const latestRecord = await repo.loadSession(day, latest)
      return openSession(latestRecord?.completed ? latest + 1 : latest)
    },
    async startDrill() {
      const s = snapshot.session
      if (!s || s.phase !== 'done') return
      const drill = createDrill(s)
      if (!drill) return
      set({ session: drill })
      await dispatch({ type: 'start' })
    },
    dispatch,
  }
}
