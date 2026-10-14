// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurriculum, knowledgePointsOfPhase } from '../../curriculum/curriculum'
import { MODALITIES, masteryKey } from '../../curriculum/knowledgePoints'
import type { PlaybackPlan } from '../../music/playback'
import { initialMastery } from '../../scheduling/mastery'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { boot, type LazyAudio, type LazyMic } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'

afterEach(cleanup)
const c = buildCurriculum()

const audio = {
  ready: true, latencySec: 0, currentTime: 0, state: 'running', context: null,
  async unlock() {}, play: (p: PlaybackPlan) => ({ startSec: 0, endSec: p.totalDurSec }), stopAll() {}, onStateChange: () => () => {},
} as unknown as LazyAudio
const mic: LazyMic = { failure: null, async ensure() {}, async start() {}, async stop() { return [] }, close() {} }

async function mount(repo: MemoryRepository) {
  const r = await boot({ openRepo: async () => repo, audio, mic, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 14, 9), randomId: () => 'p' })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={mic}><Shell storageWarning={null} /></RuntimeProvider>)
}

async function setup(strong: boolean) {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-14', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION, vocalRange: null, singMode: 'self' })
  if (strong)
    for (const kp of knowledgePointsOfPhase(c, 'P1'))
      for (const m of MODALITIES)
        await repo.putMastery(masteryKey(kp, m), { ...initialMastery(), stability: 40, contextLevel: 1, variationLevel: 1, window: Array.from({ length: 20 }, (_, i) => ({ correct: true, day: i, difficultyStep: 3 })), lastSeenDay: 19 })
  await mount(repo)
  return { repo }
}

describe('实战关入口（P-5 spec §4.1）', () => {
  it('掌握度未达标：没有入口，显示还差几项', async () => {
    await setup(false)
    expect(await screen.findByText(/达标后可挑战实战关/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '挑战实战关' })).toBeNull()
  })

  it('达标：显示入口，点击进入关卡页，返回回到首页', async () => {
    await setup(true)
    const entry = await screen.findByRole('button', { name: '挑战实战关' })
    await act(async () => { fireEvent.click(entry) })
    expect(await screen.findByRole('heading', { name: '实战关' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '返回' })) })
    expect(await screen.findByRole('button', { name: '挑战实战关' })).toBeTruthy()
  })

  it('当天次数用完：入口禁用', async () => {
    const { repo } = await setup(true)
    for (let k = 0; k < 3; k++) await repo.appendBossAttempt({ phaseId: 'P1', day: 0, seed: k, parts: { melody: 0 }, passed: false, at: 'x' })
    cleanup()
    // 重新挂载以触发刷新
    await mount(repo)
    expect(await screen.findByText(/今天的挑战次数已用完/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '挑战实战关' })).toHaveProperty('disabled', true)
  })
})
