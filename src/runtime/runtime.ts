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
  /** 落盘失败的原因（只读降级时设置；不会被 itemError 覆盖） */
  storageError: string | null
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
  let snapshot: RuntimeSnapshot = { profile: null, session: null, storage: 'ok', lastError: null, storageError: null }
  let mastery = new Map<MasteryKey, MasteryState>()
  let cancelTimer: (() => void) | null = null
  let queue: Promise<void> = Promise.resolve()
  /** 所有会改状态的入口串行执行：下一个操作等上一个的全部副作用落盘后再开始 */
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const p = queue.then(op)
    queue = p.then(() => undefined, () => undefined)
    return p
  }
  const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e))
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
        set({ storage: 'readOnly', storageError: `进度暂时无法保存（可导出备份）：${describe(e)}` })
      }
    }
  }

  async function ensureProfileNow(): Promise<Profile> {
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
          dispatch({ type: 'contentPlayed' }).catch((e) => set({ lastError: describe(e) }))
        })
        return
      }
      case 'stopAudio':
        cancelTimer?.()
        cancelTimer = null
        audio.stopAll()
        return
      case 'saveMastery':
        return write(() => repo.putMastery(effect.key, effect.state))
      case 'saveAttempt':
        return write(() => repo.appendAttempt(effect.attempt))
      case 'saveSession':
        return write(() => repo.putSession(effect.record))
      case 'advancePhase': {
        const p = { ...(snapshot.profile ?? (await ensureProfileNow())), phaseId: effect.to }
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

  async function dispatchNow(event: SessionEvent): Promise<void> {
    const session = snapshot.session
    if (!session) return
    const { state, effects } = reduce(session, event, { curriculum, mastery, nowIso: deps.nowIso() })
    set({ session: state })
    // 掌握度副本先同步更新，之后任何 await 都不会让后续 reduce 读到旧值
    for (const e of effects) if (e.type === 'saveMastery') mastery = new Map(mastery).set(e.key, e.state)
    try {
      for (const e of effects) {
        try {
          await run(e)
        } catch (err) {
          set({ lastError: describe(err) })
        }
      }
    } finally {
      notify()
    }
  }
  const dispatch = (event: SessionEvent) => serial(() => dispatchNow(event))

  async function begin(state: SessionState): Promise<void> {
    mastery = await repo.loadMastery()
    set({ session: state })
    await dispatchNow({ type: 'start' })
  }

  async function openSession(sessionNo: number): Promise<void> {
    const p = await ensureProfileNow()
    const day = today(p)
    const live = snapshot.session
    const liveActive = live !== null && live.phase !== 'done' && live.phase !== 'idle'
    // 同一场正在进行：不重复开（避免重复播放）
    if (liveActive && live.mode === 'session' && live.day === day && live.sessionNo === sessionNo) return
    const record = await repo.loadSession(day, sessionNo)
    if (record?.completed) return
    if (liveActive) {
      cancelTimer?.()
      cancelTimer = null
      audio.stopAll()
    }
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
    ensureProfile: () => serial(ensureProfileNow),
    todayStatus: () => serial(async () => {
      const p = await ensureProfileNow()
      const r = await repo.loadSession(today(p), 0)
      return !r ? 'notStarted' as const : r.completed ? 'mainDone' as const : 'inProgress' as const
    }),
    startToday: () => serial(() => openSession(0)),
    startExtra: () => serial(async () => {
      const p = await ensureProfileNow()
      const day = today(p)
      const main = await repo.loadSession(day, 0)
      if (!main?.completed) return
      const latest = (await repo.latestSessionNo(day)) ?? 0
      const latestRecord = await repo.loadSession(day, latest)
      return openSession(latestRecord?.completed ? latest + 1 : latest)
    }),
    startDrill: () => serial(async () => {
      const s = snapshot.session
      if (!s || s.phase !== 'done') return
      const drill = createDrill(s)
      if (!drill) return
      set({ session: drill })
      await dispatchNow({ type: 'start' })
    }),
    dispatch,
  }
}
