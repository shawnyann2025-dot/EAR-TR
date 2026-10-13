import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './AudioEngine'
import { emptyPlan, notesToPlan } from '../music/playback'

/** 记录所有创建过的节点与调用，供断言用 */
function makeFakeContext() {
  const created = { oscillators: [] as any[], gains: [] as any[] }
  let now = 0

  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  })

  const ctx = {
    state: 'running' as AudioContextState,
    get currentTime() {
      return now
    },
    destination: { name: 'destination' },
    resume: vi.fn(async () => {
      ctx.state = 'running'
    }),
    close: vi.fn(async () => {}),
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'sine' as OscillatorType,
        frequency: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as null | (() => void),
      }
      created.oscillators.push(osc)
      return osc
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: makeParam(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      created.gains.push(gain)
      return gain
    }),
  }

  return { ctx: ctx as unknown as AudioContext, created, setNow: (t: number) => (now = t) }
}

describe('AudioEngine', () => {
  let fake: ReturnType<typeof makeFakeContext>
  let engine: AudioEngine

  beforeEach(() => {
    fake = makeFakeContext()
    engine = new AudioEngine(fake.ctx)
  })

  it('currentTime 取自 AudioContext，而非 Date.now()', () => {
    fake.setNow(12.5)
    expect(engine.currentTime).toBe(12.5)
  })

  it('为每个分音创建一个振荡器', () => {
    // piano 有 4 个分音，两个音符 → 8 个振荡器
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 64, atSec: 1, durSec: 1 },
      ],
      'piano',
    )
    engine.play(plan)
    expect(fake.created.oscillators).toHaveLength(8)
  })

  it('振荡器的启停时刻基于 AudioContext 时钟加上延迟', () => {
    fake.setNow(100)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'electronic')
    const { startSec } = engine.play(plan, 0.2)
    expect(startSec).toBeCloseTo(100.2, 6)
    for (const osc of fake.created.oscillators) {
      expect(osc.start).toHaveBeenCalledWith(expect.closeTo(100.2, 6))
    }
  })

  it('分音频率是基频的对应倍数', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1 }], 'electronic')
    engine.play(plan)
    // electronic 的分音倍数是 1、2、6
    const freqs = fake.created.oscillators.map(
      (o: any) => o.frequency.setValueAtTime.mock.calls[0][0],
    )
    expect(freqs[0]).toBeCloseTo(440, 4)
    expect(freqs[1]).toBeCloseTo(880, 4)
    expect(freqs[2]).toBeCloseTo(2640, 4)
  })

  it('返回的 endSec 覆盖整个计划含释音', () => {
    fake.setNow(0)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'piano')
    const { endSec } = engine.play(plan, 0)
    expect(endSec).toBeGreaterThan(1)
  })

  it('stopAll 断开所有已创建节点', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    engine.play(plan)
    engine.stopAll()
    for (const osc of fake.created.oscillators) {
      expect(osc.disconnect).toHaveBeenCalled()
    }
  })

  it('stopAll 后再 play 仍然工作', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    engine.play(plan)
    engine.stopAll()
    const before = fake.created.oscillators.length
    engine.play(plan)
    expect(fake.created.oscillators.length).toBeGreaterThan(before)
  })

  it('resume 在 context 挂起时调用 ctx.resume', async () => {
    ;(fake.ctx as any).state = 'suspended'
    await engine.resume()
    expect(fake.ctx.resume).toHaveBeenCalled()
  })

  it('播放空计划不创建任何节点也不抛错', () => {
    expect(() => engine.play(emptyPlan())).not.toThrow()
    expect(fake.created.oscillators).toHaveLength(0)
  })

  it('短音符 + 长衰减音色下，amp 包络的自动化时刻单调不减（不早于 stopSec 之前的断点倒挂）', () => {
    // piano 的 decaySec 是 1.6s，音符时值只有 0.3s（远短于 decay），
    // 这是最容易触发「decayEnd 超过 stopSec，导致后续 ramp 时刻倒挂」的场景。
    fake.setNow(0)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 0.3 }], 'piano')
    engine.play(plan, 0)

    // spawn() 里，amp 是该声部第一个创建的 GainNode，之后才是各分音的 partialGain。
    const amp = fake.created.gains[0]
    const setCalls = amp.gain.setValueAtTime.mock.calls.map((args: any[]) => args[1] as number)
    const rampCalls = amp.gain.linearRampToValueAtTime.mock.calls.map(
      (args: any[]) => args[1] as number,
    )

    // 按调用顺序合并两类自动化事件的时刻，断言整体单调不减。
    const setCallOrder = amp.gain.setValueAtTime.mock.invocationCallOrder as number[]
    const rampCallOrder = amp.gain.linearRampToValueAtTime.mock.invocationCallOrder as number[]
    const events = [
      ...setCalls.map((t: number, i: number) => ({ order: setCallOrder[i], t })),
      ...rampCalls.map((t: number, i: number) => ({ order: rampCallOrder[i], t })),
    ].sort((a, b) => a.order - b.order)

    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t)
    }
  })
})

describe('FWD-1：已结束的节点不再累积', () => {
  it('每个音的全部振荡器结束后，active 恢复为 0；连续播放不线性增长', () => {
    const { ctx, created } = makeFakeContext()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 0.5 }, { midi: 64, atSec: 0.5, durSec: 0.5 }], 'piano')

    for (let round = 0; round < 5; round++) {
      engine.play(plan)
      expect(engine.activeCount).toBeGreaterThan(0)
      // 模拟所有已创建振荡器播完
      for (const osc of created.oscillators) osc.onended?.()
      expect(engine.activeCount).toBe(0)
    }
  })

  it('stopAll 之后 activeCount 为 0', () => {
    const { ctx } = makeFakeContext()
    const engine = new AudioEngine(ctx as unknown as AudioContext)
    engine.play(notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'strings'))
    engine.stopAll()
    expect(engine.activeCount).toBe(0)
  })
})
