// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MicError } from '../../audio/micCapture'
import type { PlaybackPlan } from '../../music/playback'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION, type Profile } from '../../storage/types'
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

async function setup(mic: LazyMic, extra: Partial<Profile> = {}) {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, vocalRange: null, ...extra })
  const audio = fakeAudio()
  const r = await boot({ openRepo: async () => repo, audio, mic, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 13, 9), randomId: () => 'p' })
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
