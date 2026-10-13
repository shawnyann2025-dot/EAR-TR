import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { answerAsResponse } from '../exercises/generate'
import type { PlaybackPlan } from '../music/playback'
import { MemoryRepository } from '../storage/memory'
import type { Repository } from '../storage/types'
import { createRuntime, type AudioPort, type RuntimeDeps, type TimerPort } from './runtime'

const c = buildCurriculum()

function fakes() {
  const played: PlaybackPlan[] = []
  let stopped = 0
  const audio: AudioPort = {
    currentTime: 0,
    play: (plan) => { played.push(plan); return { startSec: 0, endSec: plan.totalDurSec } },
    stopAll: () => { stopped++ },
  }
  const pending: (() => void)[] = []
  const timer: TimerPort = {
    after: (_s, fn) => { pending.push(fn); return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) } },
  }
  const flush = () => { while (pending.length) pending.shift()!() }
  return { audio, timer, played, flush, stoppedCount: () => stopped }
}

function deps(repo: Repository, today = '2026-10-13'): RuntimeDeps & ReturnType<typeof fakes> {
  const f = fakes()
  return { ...f, repo, curriculum: c, nowIso: () => '2026-10-13T08:00:00.000Z', todayLocalDate: () => today, newProfileId: () => 'p-test' }
}

/** 一直答对，直到会话结束（或到 limit 道题为止） */
async function playThrough(rt: ReturnType<typeof createRuntime>, flush: () => void, limit = Infinity) {
  let n = 0
  while (rt.getSnapshot().session?.phase !== 'done' && n < limit) {
    flush() // 播完 → contentPlayed
    const s = rt.getSnapshot().session!
    if (s.phase === 'answering') {
      await rt.dispatch({ type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 })
      n++
      await rt.dispatch({ type: 'next' })
    }
  }
}

describe('createRuntime', () => {
  it('首次：建 Profile，开今天的主线会话，播放第一题', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    expect(await rt.todayStatus()).toBe('notStarted')
    await rt.startToday()
    expect((await repo.loadProfile())?.id).toBe('p-test')
    expect(rt.getSnapshot().session?.phase).toBe('presenting')
    expect(d.played).toHaveLength(1)
    expect(await rt.todayStatus()).toBe('inProgress')
  })

  it('完整跑完一场：作答、掌握度、会话记录都落盘；todayStatus 变为 mainDone', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush)
    const s = rt.getSnapshot().session!
    expect(s.phase).toBe('done')
    expect(await repo.countAttempts()).toBe(s.progress.attempted)
    expect((await repo.loadMastery()).size).toBeGreaterThan(0)
    expect((await repo.loadSession(0, 0))?.completed).toBe(true)
    expect(await rt.todayStatus()).toBe('mainDone')
  })

  it('中途换一个 runtime（模拟杀掉页面）：从记录续起，不重复已答的题', async () => {
    const repo = new MemoryRepository()
    const d1 = deps(repo)
    const rt1 = createRuntime(d1)
    await rt1.startToday()
    await playThrough(rt1, d1.flush, 3)
    const answered = await repo.countAttempts()
    const indexBefore = (await repo.loadSession(0, 0))!.index

    const d2 = deps(repo)
    const rt2 = createRuntime(d2)
    await rt2.startToday()
    expect(rt2.getSnapshot().session?.current?.planIndex).toBe(indexBefore)
    await playThrough(rt2, d2.flush)
    expect(await repo.countAttempts()).toBeGreaterThan(answered)
    expect((await repo.loadSession(0, 0))?.completed).toBe(true)
  })

  it('中断：停播并取消计时；恢复后重出同一道题', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    await rt.startToday()
    const first = rt.getSnapshot().session!.current!.exercise
    await rt.dispatch({ type: 'interrupted' })
    expect(d.stoppedCount()).toBe(1)
    expect(rt.getSnapshot().session?.phase).toBe('idle')
    await rt.dispatch({ type: 'start' })
    expect(rt.getSnapshot().session?.current?.exercise).toEqual(first)
  })

  it('加练：主线完成后开第 1 场', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush)
    await rt.startExtra()
    expect(rt.getSnapshot().session?.sessionNo).toBe(1)
    expect(rt.getSnapshot().session?.phase).toBe('presenting')
  })

  it('落盘失败：重试一次后进入只读警告，练习继续', async () => {
    const repo = new MemoryRepository()
    let fail = false
    const flaky: Repository = new Proxy(repo, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver)
        if (typeof v !== 'function') return v
        return (...args: unknown[]) => {
          if (fail && String(prop).startsWith('put') || fail && prop === 'appendAttempt') return Promise.reject(new Error('disk full'))
          return v.apply(target, args)
        }
      },
    })
    const d = deps(flaky)
    const rt = createRuntime(d)
    await rt.startToday()
    fail = true
    await playThrough(rt, d.flush, 2)
    expect(rt.getSnapshot().storage).toBe('readOnly')
    expect(rt.getSnapshot().lastError).toMatch(/disk full/)
    expect(rt.getSnapshot().session?.phase).not.toBe('idle')
  })

  it('订阅者在每次 dispatch 后收到快照', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    const seen: string[] = []
    rt.subscribe((s) => seen.push(s.session?.phase ?? 'none'))
    await rt.startToday()
    d.flush()
    expect(seen).toContain('presenting')
    expect(seen.at(-1)).toBe('answering')
  })

  it('中断后再开始：旧计时已取消，只剩新计时，不会提前推进', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    const answeringEntries: number[] = []
    let prev = ''
    rt.subscribe((s) => {
      const ph = s.session?.phase ?? 'none'
      if (ph === 'answering' && prev !== 'answering') answeringEntries.push(s.session!.current!.planIndex)
      prev = ph
    })
    await rt.startToday()
    const firstIndex = rt.getSnapshot().session!.current!.planIndex
    await rt.dispatch({ type: 'interrupted' })
    await rt.dispatch({ type: 'start' })
    expect(rt.getSnapshot().session?.phase).toBe('presenting')
    d.flush() // 只触发仍在等待的回调；旧回调必须已被取消
    const s = rt.getSnapshot().session!
    expect(s.phase).toBe('answering')
    expect(s.current!.planIndex).toBe(firstIndex)
    expect(s.index).toBe(firstIndex)
    expect(answeringEntries).toEqual([firstIndex])
    expect(await d.repo.countAttempts()).toBe(0)
  })

  it('已完成的会话不会被再次续起或结算', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush)
    const before = rt.getSnapshot().session
    const attempts = await repo.countAttempts()
    const record = await repo.loadSession(0, 0)
    let writes = 0
    const orig = repo.putSession.bind(repo)
    repo.putSession = async (r) => { writes++; return orig(r) }
    const origGate = repo.putGate.bind(repo)
    repo.putGate = async (g) => { writes++; return origGate(g) }
    await rt.startToday()
    expect(rt.getSnapshot().session).toBe(before)
    expect(writes).toBe(0)
    expect(await repo.countAttempts()).toBe(attempts)
    expect(await repo.loadSession(0, 0)).toEqual(record)
  })
})
