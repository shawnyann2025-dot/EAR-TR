// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlaybackPlan } from '../../music/playback'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { boot, type LazyAudio, type LazyMic } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(cleanup)

const audio = {
  ready: true, latencySec: 0, currentTime: 0, state: 'running', context: null,
  async unlock() {}, play: (p: PlaybackPlan) => ({ startSec: 0, endSec: p.totalDurSec }), stopAll() {}, onStateChange: () => () => {},
} as unknown as LazyAudio
const mic: LazyMic = { failure: null, async ensure() {}, async start() {}, async stop() { return [] }, close() {} }

describe('设置页版本与存储信息（P-6 spec §3.4）', () => {
  it('显示版本、数据格式与持久化状态', async () => {
    const repo = new MemoryRepository()
    await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-14', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, vocalRange: null, singMode: 'self' })
    const r = await boot({ openRepo: async () => repo, audio, mic, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 14, 9), randomId: () => 'p' })
    if (r.kind !== 'ready') throw new Error('boot 失败')
    render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={mic}><Shell storageWarning={null} /></RuntimeProvider>)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '设置' })) })
    expect(await screen.findByText(`版本 ${__APP_VERSION__} · 数据格式 v2`)).toBeTruthy()
    expect(await screen.findByText('浏览器不支持持久化，请定期导出备份')).toBeTruthy()
  })
})
