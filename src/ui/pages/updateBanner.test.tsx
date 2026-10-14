// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackPlan } from '../../music/playback'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { boot, type LazyAudio, type LazyMic } from '../platform'
import { UpdateProvider } from '../pwa'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(cleanup)

const audio = {
  ready: true, latencySec: 0, currentTime: 0, state: 'running', context: null,
  async unlock() {}, play: (p: PlaybackPlan) => ({ startSec: 0, endSec: p.totalDurSec }), stopAll() {}, onStateChange: () => () => {},
} as unknown as LazyAudio
const mic: LazyMic = { failure: null, async ensure() {}, async start() {}, async stop() { return [] }, close() {} }

function fakePort() {
  let need = false
  const subs = new Set<() => void>()
  const apply = vi.fn(async () => {})
  return {
    port: { get needRefresh() { return need }, subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn) }, apply },
    fire() { need = true; subs.forEach((f) => f()) },
    apply,
  }
}

async function setup() {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-14', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, vocalRange: null, singMode: 'self' })
  const r = await boot({ openRepo: async () => repo, audio, mic, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 14, 9), randomId: () => 'p' })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  const p = fakePort()
  render(
    <UpdateProvider port={p.port}>
      <RuntimeProvider runtime={r.runtime} audio={audio} mic={mic}><Shell storageWarning={null} /></RuntimeProvider>
    </UpdateProvider>,
  )
  await screen.findByRole('button', { name: '开始今天的练习' })
  return p
}

const BANNER = '有新版本，点此更新'

describe('更新横幅只在首页（P-6 spec §3.3）', () => {
  it('首页：出现并可点击一次触发 apply', async () => {
    const p = await setup()
    expect(screen.queryByRole('button', { name: BANNER })).toBeNull()
    act(() => p.fire())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: BANNER })) })
    expect(p.apply).toHaveBeenCalledTimes(1)
  })

  it('设置页没有；返回首页后出现', async () => {
    const p = await setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '设置' })) })
    act(() => p.fire())
    expect(screen.queryByRole('button', { name: BANNER })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '返回' })) })
    expect(await screen.findByRole('button', { name: BANNER })).toBeTruthy()
  })

  it('练习页没有', async () => {
    const p = await setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始今天的练习' })) })
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    expect(screen.queryByRole('button', { name: '开始今天的练习' })).toBeNull()
    act(() => p.fire())
    expect(screen.queryByRole('button', { name: BANNER })).toBeNull()
  })
})
