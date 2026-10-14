// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { generate } from '../../exercises/generate'
import type { PlaybackPlan } from '../../music/playback'
import { initialPlacement } from '../../scheduling/placement'
import { MemoryRepository } from '../../storage/memory'
import { labelFor } from '../labels'
import { boot, type LazyAudio } from '../platform'
import { probeSeed, probeSpec } from '../placementProbe'
import { RuntimeProvider } from '../RuntimeContext'
import type { SingMic } from '../singMic'
import { Shell } from '../Shell'

afterEach(cleanup)
const c = buildCurriculum()

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

async function setup(audioOverride?: LazyAudio) {
  const repo = new MemoryRepository()
  const audio = audioOverride ?? fakeAudio()
  const r = await boot({ openRepo: async () => repo, audio, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 13, 9), randomId: () => 'p-new' })
  if (r.kind !== 'ready') throw new Error('boot 失败')
  render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={fakeMic}><Shell storageWarning={null} /></RuntimeProvider>)
  return { repo }
}

describe('首次使用', () => {
  it('新用户先看到周期说明与耳机建议；跳过 → 从 P1 开始，进入首页', async () => {
    const { repo } = await setup()
    expect(await screen.findByText(/6–9 个月/)).toBeTruthy()
    expect(screen.getByText(/耳机/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '跳过，从头开始' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始练习' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '跳过，以后再测' })) })
    expect((await repo.loadProfile())!.placement).toEqual({ done: true, startPhase: 'P1' })
    expect(await screen.findByRole('button', { name: '开始今天的练习' })).toBeTruthy()
  })

  it('分级：连错两题即结束，起点 P1，且不写任何作答', async () => {
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始分级测试' })) })
    const probes = initialPlacement(c).probes
    for (let i = 0; i < 2; i++) {
      const ex = generate(probeSpec(c, probes[i], probeSeed('p-new', i)), c)
      if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('前两个探针应是选择题')
      const correct = ex.answer.id
      const wrong = ex.format.options.find((o) => o.id !== correct)!.id
      const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '我听完了' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor(wrong, ctx) })) })
    }
    expect(await screen.findByText(/从 P1/)).toBeTruthy()
    expect(await repo.countAttempts()).toBe(0)
  })

  it('前 5 题答对、再连错两题 → 起点 P2；开始练习写入 P2，且无作答、掌握度、会话', async () => {
    const { repo } = await setup()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始分级测试' })) })
    const probes = initialPlacement(c).probes
    for (let i = 0; i < 7; i++) {
      const ex = generate(probeSpec(c, probes[i], probeSeed('p-new', i)), c)
      if (ex.format.kind !== 'choice' || ex.answer.kind !== 'choice') throw new Error('探针应是选择题')
      const pick = i < 5 ? ex.answer.id : ex.format.options.find((o) => o.id !== (ex.answer as { id: string }).id)!.id
      const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '我听完了' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: labelFor(pick, ctx) })) })
    }
    expect(await screen.findByText(/从 P2/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '开始练习' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '跳过，以后再测' })) })
    const p = (await repo.loadProfile())!
    expect(p.phaseId).toBe('P2')
    expect(p.placement).toEqual({ done: true, startPhase: 'P2' })
    expect(await repo.countAttempts()).toBe(0)
    expect((await repo.loadMastery()).size).toBe(0)
    expect(await repo.latestSessionNo(0)).toBeNull()
  })
})
