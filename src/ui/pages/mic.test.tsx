// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MicError } from '../../audio/micCapture'
import type { PlaybackPlan } from '../../music/playback'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION, type Profile } from '../../storage/types'
import type { TimerPort } from '../../runtime/runtime'
import { boot, type LazyAudio, type LazyMic } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(cleanup)

function fakeAudio(): LazyAudio {
  return {
    ready: true, latencySec: 0, currentTime: 0, state: 'running', context: null,
    async unlock() {},
    play: (plan: PlaybackPlan) => ({ startSec: 0, endSec: plan.totalDurSec }),
    stopAll() {},
    onStateChange: () => () => {},
  }
}

function fakeMic(fail?: MicError): LazyMic & { ensured: number } {
  const m = {
    ensured: 0,
    failure: null as LazyMic['failure'],
    async ensure() { m.ensured++; if (fail) { m.failure = fail.reason; throw fail } },
    async start() {},
    async stop() { return [] },
    close() {},
  }
  return m
}

async function setup(mic: LazyMic, extra: Partial<Profile> = {}, timer: TimerPort = { after: () => () => {} }) {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, vocalRange: null, ...extra })
  const audio = fakeAudio()
  const r = await boot({ openRepo: async () => repo, audio, mic, timer, now: () => new Date(2026, 9, 13, 9), randomId: () => 'p' })
  if (r.kind !== 'ready') throw new Error()
  render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={mic}><Shell storageWarning={null} /></RuntimeProvider>)
  return { repo }
}

describe('开场打开麦克风（P-4 spec §4.4）', () => {
  it('检测模式：开始练习前打开并校准麦克风', async () => {
    const mic = fakeMic()
    await setup(mic)
    const btn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(btn) })
    expect(mic.ensured).toBe(1)
  })

  it('权限被拒：改为自评、记下原因、提示一次，练习照常开始', async () => {
    const mic = fakeMic(new MicError('denied', '没有麦克风权限'))
    const { repo } = await setup(mic)
    const btn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(btn) })
    const p = (await repo.loadProfile())!
    expect(p.singMode).toBe('self')
    expect(p.micFallbackReason).toBe('denied')
    expect(await screen.findByText(/第 1 \//)).toBeTruthy()
    // 提示跨页面保留：练习页上仍可见，点「知道了」消除
    expect(screen.getByText(/没有麦克风权限，唱题改为自评/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '知道了' })) })
    expect(screen.queryByText(/没有麦克风权限，唱题改为自评/)).toBeNull()
  })

  it('练习页卸载（本场结束或离开）时释放麦克风', async () => {
    const mic = fakeMic()
    let closed = 0
    mic.close = () => { closed++ }
    await setup(mic)
    const btn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(btn) })
    await screen.findByText(/第 1 \//)
    const before = closed
    cleanup()
    expect(closed).toBeGreaterThan(before)
  })

  it('pagehide 时释放麦克风', async () => {
    const mic = fakeMic()
    let closed = 0
    mic.close = () => { closed++ }
    await setup(mic)
    await screen.findByRole('button', { name: '开始今天的练习' })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(closed).toBe(1)
  })

  it('自评模式不打开麦克风', async () => {
    const mic = fakeMic()
    await setup(mic, { singMode: 'self' })
    const btn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(btn) })
    expect(mic.ensured).toBe(0)
  })
})

describe('设置：唱题判定', () => {
  it('切换判定方式写入 Profile；切回检测清掉回落原因', async () => {
    const mic = fakeMic()
    const { repo } = await setup(mic, { singMode: 'self', micFallbackReason: 'denied' })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    expect(screen.getByText(/没有麦克风权限/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByLabelText('音高检测')) })
    const p = (await repo.loadProfile())!
    expect(p.singMode).toBe('detect')
    expect(p.micFallbackReason).toBeUndefined()
  })
})

describe('重听与中断（P-4b 终审）', () => {
  function manualTimer() {
    const pending: (() => void)[] = []
    const timer: TimerPort = { after: (_s, fn) => { pending.push(fn); return () => { const i = pending.indexOf(fn); if (i >= 0) pending.splice(i, 1) } } }
    const flush = async () => { await act(async () => { while (pending.length) pending.shift()!(); for (let i = 0; i < 5; i++) await Promise.resolve() }) }
    return { timer, flush }
  }
  const replayBtn = () => screen.queryByRole('button', { name: '重听' }) as HTMLButtonElement | null

  it('检测模式的唱题（热身）：没有可用的「重听」，作答期间也不能播放', async () => {
    const { timer, flush } = manualTimer()
    await setup(fakeMic(), {}, timer)
    const startBtn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(startBtn) })
    await screen.findByText(/第 1 \//)
    await flush() // 进入 answering
    const b = replayBtn()
    expect(b === null || b.disabled).toBe(true)
  })

  it('自评模式：作答期间「重听」可用', async () => {
    const { timer, flush } = manualTimer()
    await setup(fakeMic(), { singMode: 'self' }, timer)
    const startBtn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(startBtn) })
    await screen.findByText(/第 1 \//)
    await flush()
    expect(replayBtn()!.disabled).toBe(false)
  })

  it('中断（页面隐藏）时关闭麦克风', async () => {
    const mic = fakeMic()
    let closed = 0
    mic.close = () => { closed++ }
    const { timer, flush } = manualTimer()
    await setup(mic, {}, timer)
    const startBtn = await screen.findByRole('button', { name: '开始今天的练习' })
    await act(async () => { fireEvent.click(startBtn) })
    await screen.findByText(/第 1 \//)
    await flush()
    const before = closed
    const orig = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(closed).toBeGreaterThan(before)
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState
      void orig
    }
  })
})
