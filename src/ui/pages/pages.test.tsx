// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackPlan } from '../../music/playback'
import type { TimerPort } from '../../runtime/runtime'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { labelFor } from '../labels'
import { boot, type LazyAudio } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import type { SingMic } from '../singMic'
import { Shell } from '../Shell'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const fakeMic: SingMic = { ensure: async () => {}, start: async () => {}, stop: async () => [], close: () => {} }

function fakeAudio(): LazyAudio {
  return {
    ready: true,
    latencySec: 0,
    context: null,
    state: 'running',
    currentTime: 0,
    async unlock() {},
    play: (plan: PlaybackPlan) => ({ startSec: 0, endSec: plan.totalDurSec }),
    stopAll() {},
    onStateChange: () => () => {},
  }
}

function manualTimer() {
  const pending: (() => void)[] = []
  const timer: TimerPort = {
    after: (_s, fn) => {
      pending.push(fn)
      return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) }
    },
  }
  /** 让排队的「播完」回调触发，并等 runtime 的串行队列跑完 */
  const flush = async () => {
    await act(async () => {
      while (pending.length) pending.shift()!()
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
  }
  return { timer, flush }
}

async function setup(profileId = 'p') {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: profileId, createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, singMode: 'self' })
  const audio = fakeAudio()
  const { timer, flush } = manualTimer()
  const r = await boot({ openRepo: async () => repo, audio, timer, now: () => new Date(2026, 9, 13, 9), randomId: () => profileId })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={fakeMic}><Shell storageWarning={null} /></RuntimeProvider>)
  return { runtime: r.runtime, flush, repo }
}

async function clickStart() {
  const btn = await screen.findByRole('button', { name: '开始今天的练习' })
  await act(async () => { fireEvent.click(btn) })
}

/**
 * 热身题恒为「唱」模态（pitch 自评格式，见 scheduling/candidates.ts），首题不可能是选择题，
 * 换 profileId 无效。这里经 runtime 自评答对并推进，直到出现第一道选择题（停在 presenting）。
 */
async function advanceToChoice(runtime: Awaited<ReturnType<typeof setup>>['runtime'], flush: () => Promise<void>) {
  for (let i = 0; i < 30; i++) {
    const ex = runtime.getSnapshot().session!.current!.exercise
    if (ex.format.kind === 'choice' && ex.answer.kind === 'choice') return
    await flush()
    await act(async () => { await runtime.dispatch({ type: 'answer', response: { kind: 'pitch', selfAssessedCorrect: true }, latencyMs: 0 }) })
    await act(async () => { await runtime.dispatch({ type: 'next' }) })
  }
  throw new Error('30 题内没有出现选择题')
}

describe('首页 → 练习页', () => {
  it('显示阶段；开始后进入练习页；选择题播完前不可点', async () => {
    const { runtime, flush } = await setup()
    expect(await screen.findByText(/P1 ·/)).toBeTruthy()
    await clickStart()
    const s = runtime.getSnapshot().session!
    expect(s.phase).toBe('presenting')
    expect(screen.getByText(/第 1 \//)).toBeTruthy()
    await advanceToChoice(runtime, flush)
    const ex = runtime.getSnapshot().session!.current!.exercise
    if (ex.format.kind !== 'choice') throw new Error('advanceToChoice 之后应为选择题')
    const name = labelFor(ex.format.options[0].id, { scheme: 'solfege', mode: ex.resolved.key.mode, prompt: ex.prompt })
    expect(screen.getAllByRole('button', { name })[0]).toHaveProperty('disabled', true)
    await flush()
    expect(screen.getAllByRole('button', { name })[0]).toHaveProperty('disabled', false)
  })

  it('答对后显示「答对了」，0.7 秒后自动进入下一题', async () => {
    const { runtime, flush } = await setup()
    await clickStart()
    await advanceToChoice(runtime, flush)
    await flush()
    const idx = runtime.getSnapshot().session!.current!.planIndex
    const ex = runtime.getSnapshot().session!.current!.exercise
    if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('首题应为选择题')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor((ex.answer as { id: string }).id, ctx) })) })
    expect(screen.getByText('答对了')).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(800) })
    vi.useRealTimers()
    await flush()
    expect(runtime.getSnapshot().session!.current!.planIndex).toBe(idx + 1)
  })

  it('结束本场 → 总结页 → 回到首页显示「再练一场」', async () => {
    const { runtime } = await setup()
    await clickStart()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束本场' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确定结束本场？' })) })
    expect(runtime.getSnapshot().session!.phase).toBe('done')
    expect(await screen.findByText(/今日总结/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '回到首页' })) })
    expect(await screen.findByRole('button', { name: '再练一场' })).toBeTruthy()
  })

  it('结束本场：单击只进入确认，不结束；超时后恢复', async () => {
    const { runtime } = await setup()
    await clickStart()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束本场' })) })
    expect(screen.getByRole('button', { name: '确定结束本场？' }).className).toContain('danger')
    expect(runtime.getSnapshot().session!.phase).not.toBe('done')
    await act(async () => { vi.advanceTimersByTime(4100) })
    expect(screen.getByRole('button', { name: '结束本场' })).toBeTruthy()
    expect(runtime.getSnapshot().session!.phase).not.toBe('done')
  })

  it('页面隐藏时，答对后不自动进入下一题', async () => {
    const { runtime, flush } = await setup()
    await clickStart()
    await advanceToChoice(runtime, flush)
    await flush()
    const idx = runtime.getSnapshot().session!.current!.planIndex
    const ex = runtime.getSnapshot().session!.current!.exercise
    if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('首题应为选择题')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor((ex.answer as { id: string }).id, ctx) })) })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await act(async () => { vi.advanceTimersByTime(800) })
      vi.useRealTimers()
      await flush()
      expect(runtime.getSnapshot().session!.phase).toBe('feedback')
      expect(runtime.getSnapshot().session!.current!.planIndex).toBe(idx)
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
  })

  it('中断后显示「继续」，点击后重出同一道题', async () => {
    const { runtime } = await setup()
    await clickStart()
    const before = runtime.getSnapshot().session!.current!.exercise
    await act(async () => { await runtime.dispatch({ type: 'interrupted' }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '继续' })) })
    expect(runtime.getSnapshot().session!.current!.exercise).toEqual(before)
  })
})

describe('设置页', () => {
  it('切换显示皮肤写入 Profile；导出触发下载', async () => {
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x' }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    await act(async () => { fireEvent.click(screen.getByLabelText('数字')) })
    expect((await repo.loadProfile())!.displayScheme).toBe('numeric')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出备份' })) })
    expect(created).toHaveLength(1)
    expect(JSON.parse(await created[0].text()).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('导入坏文件：提示原因，数据不变', async () => {
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    const input = screen.getByLabelText('导入备份') as HTMLInputElement
    const file = new File(['not json'], 'x.json', { type: 'application/json' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    expect(await screen.findByText(/导入失败/)).toBeTruthy()
    expect((await repo.loadProfile())!.id).toBe('p')
  })
})
