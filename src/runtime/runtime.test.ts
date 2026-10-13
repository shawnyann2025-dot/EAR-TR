import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { fitToRange, VOICE_PRESETS } from '../pitch/range'
import { answerAsResponse, generate as generateEx } from '../exercises/generate'
import type { Response } from '../exercises/types'
import type { PlaybackPlan } from '../music/playback'
import { masteryKey } from '../curriculum/knowledgePoints'
import { knowledgePointsOfPhase } from '../curriculum/curriculum'
import { MODALITIES } from '../curriculum/knowledgePoints'
import type { MasteryState } from '../scheduling/mastery'
import { initialMastery } from '../scheduling/mastery'
import type { SessionRecord } from '../session/types'
import { MemoryRepository } from '../storage/memory'
import { StorageImportError, type Repository } from '../storage/types'
import { createRuntime, type AudioPort, type RuntimeDeps, type TimerPort } from './runtime'

const c = buildCurriculum()

function fakes() {
  const played: PlaybackPlan[] = []
  let stopped = 0
  const audio: AudioPort = {
    currentTime: 0,
    play: (plan, _opts) => { played.push(plan); return { startSec: 0, endSec: plan.totalDurSec } },
    stopAll: () => { stopped++ },
  }
  const pending: (() => void)[] = []
  const timer: TimerPort = {
    after: (_s, fn) => { pending.push(fn); return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) } },
  }
  /** 触发仍在等待的计时回调，并等排队的 dispatch 跑完 */
  const flush = async () => {
    while (pending.length) pending.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { audio, timer, played, flush, stoppedCount: () => stopped }
}

function deps(repo: Repository, today = '2026-10-13'): RuntimeDeps & ReturnType<typeof fakes> {
  const f = fakes()
  return { ...f, repo, curriculum: c, nowIso: () => '2026-10-13T08:00:00.000Z', todayLocalDate: () => today, newProfileId: () => 'p-test' }
}

/** 一直答对，直到会话结束（或到 limit 道题为止） */
async function playThrough(rt: ReturnType<typeof createRuntime>, flush: () => Promise<void>, limit = Infinity) {
  let n = 0
  while (rt.getSnapshot().session?.phase !== 'done' && n < limit) {
    await flush() // 播完 → contentPlayed
    const s = rt.getSnapshot().session!
    if (s.phase === 'answering') {
      await rt.dispatch({ type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 })
      n++
      await rt.dispatch({ type: 'next' })
    }
  }
}

/** 同种类的必错作答 */
function wrongResponse(r: Response): Response {
  switch (r.kind) {
    case 'choice': return { kind: 'choice', id: '__none__' }
    case 'sequence': return { kind: 'sequence', ids: [] }
    case 'pitch': return { kind: 'pitch', selfAssessedCorrect: false }
    case 'tap': return { kind: 'tap', tapsSec: [] }
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
    const planned = (await repo.loadSession(0, 0))!.plan.items[indexBefore]
    const live = rt2.getSnapshot().session!.current!.spec
    expect([live.kpId, live.modality, live.seed]).toEqual([planned.kpId, planned.modality, planned.seed])
    await playThrough(rt2, d2.flush)
    expect(await repo.countAttempts()).toBeGreaterThan(answered)
    expect((await repo.loadSession(0, 0))?.completed).toBe(true)
  })

  it('中断：停播并取消计时；恢复后重出同一道题', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    await rt.startToday()
    const first = rt.getSnapshot().session!.current!.exercise
    const stoppedBefore = d.stoppedCount()
    await rt.dispatch({ type: 'interrupted' })
    expect(d.stoppedCount()).toBe(stoppedBefore + 1)
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
    expect(rt.getSnapshot().storageError).toMatch(/disk full/)
    expect(rt.getSnapshot().storageError).toContain('可导出备份')
    expect(rt.getSnapshot().session?.phase).not.toBe('idle')
  })

  it('订阅者在每次 dispatch 后收到快照', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    const seen: string[] = []
    rt.subscribe((s) => seen.push(s.session?.phase ?? 'none'))
    await rt.startToday()
    await d.flush()
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
    await d.flush() // 只触发仍在等待的回调；旧回调必须已被取消
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

  it('并发：answer 与 next 不等待就连发，慢落盘下最终记录与内存一致', async () => {
    const repo = new MemoryRepository()
    let slow = false
    const slowRepo: Repository = new Proxy(repo, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver)
        if (typeof v !== 'function') return v
        return async (...args: unknown[]) => {
          if (slow && prop === 'appendAttempt') await new Promise((r) => setTimeout(r, 20))
          return v.apply(target, args)
        }
      },
    })
    const d = deps(slowRepo)
    const rt = createRuntime(d)
    await rt.startToday()
    for (let guard = 0; ; guard++) {
      expect(guard).toBeLessThan(500)
      await d.flush()
      const s = rt.getSnapshot().session!
      if (s.phase === 'answering' && s.index === s.plan.items.length - 1) break
      if (s.phase === 'answering') {
        await rt.dispatch({ type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 })
        await rt.dispatch({ type: 'next' })
      }
    }
    slow = true
    const s = rt.getSnapshot().session!
    const p1 = rt.dispatch({ type: 'answer', response: answerAsResponse(s.current!.exercise.answer), latencyMs: 1 })
    const p2 = rt.dispatch({ type: 'next' })
    await Promise.all([p1, p2])
    const mem = rt.getSnapshot().session!
    expect(mem.phase).toBe('done')
    const rec = (await repo.loadSession(0, 0))!
    expect(rec.completed).toBe(true)
    expect(rec.index).toBe(mem.index)
    expect(await rt.todayStatus()).toBe('mainDone')
  })

  it('连点两次 startToday（不等待）只播放一次', async () => {
    const d = deps(new MemoryRepository())
    const rt = createRuntime(d)
    await Promise.all([rt.startToday(), rt.startToday()])
    expect(d.played).toHaveLength(1)
  })

  it('升阶段：advancePhase 更新并保存 Profile、记关卡，下一场按 P2 出题', async () => {
    const repo = new MemoryRepository()
    const strong = (): MasteryState => ({
      ...initialMastery(),
      stability: 20,
      contextLevel: 1,
      variationLevel: 1,
      window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: 10 + i, difficultyStep: 3 })),
      lastSeenDay: 29,
    })
    for (const kp of knowledgePointsOfPhase(c, 'P1')) for (const m of MODALITIES) await repo.putMastery(masteryKey(kp, m), strong())
    await repo.saveProfile({ id: 'p-test', createdAtLocalDate: '2026-09-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: false, startPhase: null }, schemaVersion: 1 })
    const rec: SessionRecord = {
      day: 30, sessionNo: 0, phaseId: 'P1', plan: { day: 30, seed: 1, phaseId: 'P1', items: [] }, index: 0,
      progress: { attempted: 0, correct: 0 }, boss: { attempted: 5, correct: 5 }, byTrack: { T: 0, H: 0, R: 0 }, reliefTriggered: false, completed: false,
    }
    await repo.putSession(rec)
    const rt = createRuntime(deps(repo, '2026-10-13'))
    await rt.startToday()
    expect(rt.getSnapshot().session?.phase).toBe('done')
    expect(rt.getSnapshot().profile?.phaseId).toBe('P2')
    expect((await repo.loadProfile())?.phaseId).toBe('P2')
    expect((await repo.exportAll('x')).gates).toEqual([{ phaseId: 'P1', passedOnDay: 30 }])
    await rt.startExtra()
    expect(rt.getSnapshot().session?.phaseId).toBe('P2')
    expect(rt.getSnapshot().session?.sessionNo).toBe(1)
  })

  it('重练：有错题时开 drill 会话，且不产生任何新落盘', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    // 答第一道计分题故意答错：用一个必错的作答（换成另一题的答案）
    let wrong = false
    for (let guard = 0; rt.getSnapshot().session?.phase !== 'done'; guard++) {
      expect(guard).toBeLessThan(500)
      await d.flush()
      const s = rt.getSnapshot().session!
      if (s.phase === 'answering') {
        const right = answerAsResponse(s.current!.exercise.answer)
        if (!wrong && s.current!.scored) {
          // 逐个尝试：答错则 wrongThisSession 增长
          await rt.dispatch({ type: 'answer', response: wrongResponse(right), latencyMs: 1 })
          wrong = s.wrongThisSession.length < rt.getSnapshot().session!.wrongThisSession.length
        } else await rt.dispatch({ type: 'answer', response: right, latencyMs: 1 })
        await rt.dispatch({ type: 'next' })
      }
    }
    expect(rt.getSnapshot().session!.wrongThisSession.length).toBeGreaterThan(0)
    const before = JSON.stringify(await repo.exportAll('x'))
    await rt.startDrill()
    expect(rt.getSnapshot().session?.mode).toBe('drill')
    expect(JSON.stringify(await repo.exportAll('x'))).toBe(before)
  })
})

describe('Profile 与导入导出', () => {
  const strongMastery = (): MasteryState => ({
    ...initialMastery(),
    stability: 20,
    contextLevel: 1,
    variationLevel: 1,
    window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: 10 + i, difficultyStep: 3 })),
    lastSeenDay: 29,
  })
  const profileOf = (phaseId: 'P1' | 'P2'): import('../storage/types').Profile => ({
    id: 'p-test', createdAtLocalDate: '2026-09-13', phaseId, displayScheme: 'solfege', placement: { done: false, startPhase: null }, schemaVersion: 1,
  })
  /** 今天（第 30 天）的主线记录：无题可答、实战关 5/5，开场即结算并升阶段 */
  const finishingRecord = (): SessionRecord => ({
    day: 30, sessionNo: 0, phaseId: 'P1', plan: { day: 30, seed: 1, phaseId: 'P1', items: [] }, index: 0,
    progress: { attempted: 0, correct: 0 }, boss: { attempted: 5, correct: 5 }, byTrack: { T: 0, H: 0, R: 0 }, reliefTriggered: false, completed: false,
  })
  async function seedStrongP1(repo: Repository, phaseId: 'P1' | 'P2') {
    for (const kp of knowledgePointsOfPhase(c, 'P1')) for (const m of MODALITIES) await repo.putMastery(masteryKey(kp, m), strongMastery())
    await repo.saveProfile(profileOf(phaseId))
    await repo.putSession(finishingRecord())
  }

  it('updateProfile：合并补丁、落盘、更新快照并通知', async () => {
    const repo = new MemoryRepository()
    const rt = createRuntime(deps(repo))
    let notified = 0
    rt.subscribe(() => notified++)
    const p = await rt.updateProfile({ displayScheme: 'numeric' })
    expect(p.displayScheme).toBe('numeric')
    expect(rt.getSnapshot().profile?.displayScheme).toBe('numeric')
    expect((await repo.loadProfile())?.displayScheme).toBe('numeric')
    expect(notified).toBeGreaterThan(0)
    const q = await rt.updateProfile({ placement: { done: true, startPhase: 'P2' }, phaseId: 'P2' })
    expect(q).toMatchObject({ displayScheme: 'numeric', phaseId: 'P2', id: 'p-test' })
    expect(await repo.loadProfile()).toEqual(q)
  })

  it('updateProfile 之后升阶段不会把 displayScheme 写回旧值', async () => {
    const repo = new MemoryRepository()
    await seedStrongP1(repo, 'P1')
    const rt = createRuntime(deps(repo))
    await rt.updateProfile({ displayScheme: 'numeric' })
    await rt.startToday()
    expect(rt.getSnapshot().profile).toMatchObject({ phaseId: 'P2', displayScheme: 'numeric' })
    expect(await repo.loadProfile()).toMatchObject({ phaseId: 'P2', displayScheme: 'numeric' })
  })

  it('已在目标阶段时重新结算：不重复保存 Profile，也不重复记关卡', async () => {
    const repo = new MemoryRepository()
    await seedStrongP1(repo, 'P2') // 模拟：升阶段已落盘，但会话记录没来得及标完成就被杀
    const rt = createRuntime(deps(repo))
    await rt.startToday()
    expect(rt.getSnapshot().session?.phase).toBe('done')
    expect(rt.getSnapshot().profile?.phaseId).toBe('P2')
    expect((await repo.exportAll('x')).gates).toEqual([])
  })

  it('ensureProfile 建出 Profile 后通知订阅者', async () => {
    const rt = createRuntime(deps(new MemoryRepository()))
    const seen: (string | undefined)[] = []
    rt.subscribe((s) => seen.push(s.profile?.id))
    await rt.ensureProfile()
    expect(seen).toContain('p-test')
  })

  it('importBundle：自动备份旧数据，替换数据，重置会话/档案/掌握度副本', async () => {
    const repoA = new MemoryRepository()
    const dA = deps(repoA)
    dA.newProfileId = () => 'p-A'
    const rtA = createRuntime(dA)
    await rtA.startToday()
    await playThrough(rtA, dA.flush, 3)
    const bundleA = await rtA.exportBundle()

    const repoB = new MemoryRepository()
    const dB = deps(repoB)
    dB.newProfileId = () => 'p-B'
    const rtB = createRuntime(dB)
    await rtB.startToday() // B 有一场进行中的会话
    expect(rtB.getSnapshot().session).not.toBeNull()
    const stoppedBefore = dB.stoppedCount()
    const bBefore = await rtB.exportBundle()

    await rtB.importBundle(bundleA)
    expect(dB.stoppedCount()).toBeGreaterThan(stoppedBefore)
    const snap = rtB.getSnapshot()
    expect(snap.session).toBeNull()
    expect(snap.profile?.id).toBe('p-A')
    expect(snap.lastBackup).toBe(bBefore)
    expect(JSON.parse(snap.lastBackup!).profile.id).toBe('p-B')
    const after = await repoB.exportAll('x')
    const orig = JSON.parse(bundleA)
    expect(after.profile).toEqual(orig.profile)
    expect(after.sessions).toEqual(orig.sessions)
    expect(after.attempts).toEqual(orig.attempts)
    // 掌握度副本已重置：续起 A 的会话时按导入的数据运行
    await rtB.startToday()
    expect(rtB.getSnapshot().session?.index).toBe(JSON.parse(bundleA).sessions[0].index)
  })

  it('importBundle：坏 JSON 抛 StorageImportError，仓库与运行时都不变', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.startToday()
    const before = JSON.stringify(await repo.exportAll('x'))
    const session = rt.getSnapshot().session
    await expect(rt.importBundle('{坏的')).rejects.toBeInstanceOf(StorageImportError)
    await expect(rt.importBundle(JSON.stringify({ schemaVersion: 1 }))).rejects.toBeInstanceOf(StorageImportError)
    expect(JSON.stringify(await repo.exportAll('x'))).toBe(before)
    expect(rt.getSnapshot().session).toBe(session)
    expect(rt.getSnapshot().lastBackup).toBeNull()
  })
})

describe('播放前先停', () => {
  it('每次 play 之前都调用 stopAll', async () => {
    const d = deps(new MemoryRepository())
    const order: string[] = []
    const play = d.audio.play
    const stop = d.audio.stopAll
    d.audio.play = (plan, opts) => { order.push('play'); return play(plan, opts) }
    d.audio.stopAll = () => { order.push('stop'); stop() }
    const rt = createRuntime(d)
    await rt.startToday()
    await playThrough(rt, d.flush, 3)
    expect(order.filter((x) => x === 'play').length).toBeGreaterThanOrEqual(3)
    order.forEach((x, i) => { if (x === 'play') expect(order[i - 1]).toBe('stop') })
  })
})

describe('播放信息', () => {
  it('play 时把 cutContextAtSec 交给音频，并在快照里给出 playback；中断后清空', async () => {
    const d = deps(new MemoryRepository())
    const optsSeen: unknown[] = []
    const play = d.audio.play
    d.audio.play = (plan, opts) => {
      optsSeen.push(opts)
      return play(plan, opts)
    }
    const rt = createRuntime(d)
    await rt.startToday()
    const s = rt.getSnapshot()
    const csec = s.session!.current!.exercise.contentStartSec
    expect(optsSeen.at(-1)).toEqual({ cutContextAtSec: csec })
    expect(s.playback).toEqual({ startSec: 0, contentStartSec: csec })
    await rt.dispatch({ type: 'interrupted' })
    expect(rt.getSnapshot().playback).toBeNull()
  })

  it("audio.play 抛错时 playback 为 null，不残留上一道题的值，错误进 lastError", async () => {
    const d = deps(new MemoryRepository())
    const play = d.audio.play
    let calls = 0
    d.audio.play = (plan, opts) => {
      if (++calls >= 2) throw new Error("boom")
      return play(plan, opts)
    }
    const rt = createRuntime(d)
    await rt.startToday()
    expect(rt.getSnapshot().playback).not.toBeNull()
    await d.flush()
    const s = rt.getSnapshot().session!
    await rt.dispatch({ type: "answer", response: answerAsResponse(s.current!.exercise.answer), latencyMs: 500 })
    await rt.dispatch({ type: "next" })
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(rt.getSnapshot().playback).toBeNull()
    expect(rt.getSnapshot().lastError).toContain("boom")
  })
})

describe('出题时搬入音域（P-4 spec §4.2）', () => {
  it('Profile 有音域时，唱题（热身）按 fitToRange 搬移', async () => {
    const repo = new MemoryRepository()
    const d = deps(repo)
    const rt = createRuntime(d)
    await rt.ensureProfile()
    await rt.updateProfile({ vocalRange: { lowMidi: VOICE_PRESETS.bass.lowMidi, highMidi: VOICE_PRESETS.bass.highMidi } })
    await rt.startToday()
    const cur = rt.getSnapshot().session!.current!
    expect(cur.exercise.format.kind).toBe('pitch')
    const expected = fitToRange(generateEx(cur.spec, c), { lowMidi: 41, highMidi: 62 })
    expect(cur.exercise).toEqual(expected)
  })
})
