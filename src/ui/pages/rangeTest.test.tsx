// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { midiToFreq } from '../../music/pitch'
import type { PlaybackPlan } from '../../music/playback'
import type { Segment } from '../../pitch/segments'
import { MemoryRepository } from '../../storage/memory'
import { SCHEMA_VERSION } from '../../storage/types'
import { boot, type LazyAudio, type LazyMic } from '../platform'
import { RuntimeProvider } from '../RuntimeContext'
import { Shell } from '../Shell'
import { midiName } from './RangeTest'

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

/** 每次 stop 依次返回预设的「唱住的音」 */
function scriptedMic(heldMidis: number[]): LazyMic {
  const queue = [...heldMidis]
  return {
    failure: null,
    async ensure() {},
    async start() {},
    async stop(): Promise<Segment[]> {
      const m = queue.shift()
      return m === undefined ? [] : [{ startSec: 0, endSec: 1.5, medianHz: midiToFreq(m) }]
    },
    close() {},
  }
}

async function setup(mic: LazyMic) {
  const repo = new MemoryRepository()
  await repo.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P1', displayScheme: 'solfege', placement: { done: true, startPhase: 'P1' }, schemaVersion: SCHEMA_VERSION })
  const audio = fakeAudio()
  const r = await boot({ openRepo: async () => repo, audio, mic, timer: { after: () => () => {} }, now: () => new Date(2026, 9, 13, 9), randomId: () => 'p' })
  if (r.kind !== 'ready') throw new Error()
  render(<RuntimeProvider runtime={r.runtime} audio={audio} mic={mic}><Shell storageWarning={null} /></RuntimeProvider>)
  return { repo }
}

describe('midiName', () => {
  it('60 → C4，45 → A2，67 → G4', () => {
    expect([midiName(60), midiName(45), midiName(67)]).toEqual(['C4', 'A2', 'G4'])
  })
})

describe('音域测定（P-4 spec §4.3）', () => {
  it('从未测过：首次使用后先到音域页；唱最低、最高音后保存', async () => {
    const { repo } = await setup(scriptedMic([45, 67]))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '唱好了' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '唱好了' })) })
    expect(await screen.findByText(/A2 – G4/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
    expect((await repo.loadProfile())!.vocalRange).toEqual({ lowMidi: 45, highMidi: 67 })
    expect(await screen.findByRole('button', { name: '开始今天的练习' })).toBeTruthy()
  })

  it('音域太窄：提示原因并可重测', async () => {
    await setup(scriptedMic([55, 58]))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '唱好了' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '唱好了' })) })
    expect(await screen.findByText(/音域太窄/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新测定' })).toBeTruthy()
  })

  it('选声部：直接保存预设', async () => {
    const { repo } = await setup(scriptedMic([]))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '选声部' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '女高' })) })
    expect((await repo.loadProfile())!.vocalRange).toEqual({ lowMidi: 60, highMidi: 81 })
  })

  it('跳过：保存 null，之后不再进入音域页', async () => {
    const { repo } = await setup(scriptedMic([]))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '跳过，以后再测' })) })
    expect((await repo.loadProfile())!.vocalRange).toBeNull()
    expect(await screen.findByRole('button', { name: '开始今天的练习' })).toBeTruthy()
  })

  it('麦克风出错：显示原因并提供选声部', async () => {
    const mic: LazyMic = { ...scriptedMic([]), async ensure() { throw new Error('没有麦克风权限') } }
    await setup(mic)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    expect(await screen.findByText(/没有麦克风权限/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '选声部' })).toBeTruthy()
  })

  it('打开期间提示允许权限，校准期间提示保持安静', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let finish!: () => void
    const calGate = new Promise<void>((r) => { finish = r })
    const mic: LazyMic = {
      ...scriptedMic([45, 67]),
      async ensure(opts) {
        await gate
        opts?.onCalibrating?.()
        await calGate
      },
    }
    await setup(mic)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    expect(await screen.findByText(/请在弹窗中允许使用麦克风/)).toBeTruthy()
    await act(async () => { release() })
    expect(await screen.findByText(/请保持安静 3 秒，正在校准环境噪声/)).toBeTruthy()
    await act(async () => { finish() })
    expect(await screen.findByRole('button', { name: '唱好了' })).toBeTruthy()
  })

  it('start 未落定时点「唱好了」：stop 等 start 落定后才调用', async () => {
    const events: string[] = []
    let startDone!: () => void
    const startGate = new Promise<void>((r) => { startDone = r })
    const mic: LazyMic = {
      ...scriptedMic([45, 67]),
      async start() { events.push('start'); await startGate; events.push('started') },
      async stop() { events.push('stop'); return [{ startSec: 0, endSec: 1.5, medianHz: midiToFreq(45) }] },
    }
    await setup(mic)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '唱好了' })) })
    expect(events).toEqual(['start'])
    await act(async () => { startDone() })
    await screen.findByRole('button', { name: '唱好了' })
    expect(events.slice(0, 3)).toEqual(['start', 'started', 'stop'])
  })

  it('收音中卸载：等 start 落定后 stop', async () => {
    const events: string[] = []
    let startDone!: () => void
    const startGate = new Promise<void>((r) => { startDone = r })
    const mic: LazyMic = {
      ...scriptedMic([]),
      async start() { events.push('start'); await startGate; events.push('started') },
      async stop() { events.push('stop'); return [] },
    }
    await setup(mic)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '开始测定' })) })
    await screen.findByRole('button', { name: '唱好了' })
    cleanup()
    expect(events).toEqual(['start'])
    await act(async () => { startDone(); await startGate })
    expect(events).toEqual(['start', 'started', 'stop'])
  })
})
