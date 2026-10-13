import { describe, expect, it, vi } from 'vitest'
import type { PipelineIn, PipelineOut } from './pitchPipeline'
import { MIC_CONSTRAINTS, MicError, openMic, type MicDeps, type PortLike, type WorkerLike } from './micCapture'

function fakeEnv(opts: { gum?: MicDeps['getUserMedia']; workletFails?: boolean } = {}) {
  const stopTrack = vi.fn()
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  const nodePort: PortLike = { onmessage: null, postMessage: vi.fn() }
  const node = { port: nodePort, disconnect: vi.fn() }
  const sent: PipelineIn[] = []
  const worker: WorkerLike & { reply(m: PipelineOut): void } = {
    onmessage: null,
    onerror: null,
    postMessage: (m: unknown) => { sent.push(m as PipelineIn) },
    terminate: vi.fn(),
    reply(m) { this.onmessage?.({ data: m }) },
  }
  const deps: MicDeps = {
    getUserMedia: opts.gum ?? (async () => stream),
    loadWorklet: async () => { if (opts.workletFails) throw new Error('no worklet') },
    connectSource: () => node,
    createWorker: () => worker,
    wait: async () => {},
  }
  return { deps, sent, worker, node, nodePort, stopTrack }
}

const domErr = (name: string) => Object.assign(new Error(name), { name })

describe('openMic：失败分类（P-4 spec §4.4）', () => {
  it('没有 getUserMedia → unsupported', async () => {
    const { deps } = fakeEnv()
    await expect(openMic({ ...deps, getUserMedia: undefined })).rejects.toMatchObject({ reason: 'unsupported' })
  })
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'unsupported'],
    ['AbortError', 'error'],
  ])('getUserMedia 抛 %s → %s', async (name, reason) => {
    const { deps } = fakeEnv({ gum: async () => { throw domErr(name) } })
    const e = await openMic(deps).catch((x) => x)
    expect(e).toBeInstanceOf(MicError)
    expect(e.reason).toBe(reason)
  })
  it('Worklet 加载失败 → unsupported，且停掉已拿到的音轨', async () => {
    const { deps, stopTrack } = fakeEnv({ workletFails: true })
    await expect(openMic(deps)).rejects.toMatchObject({ reason: 'unsupported' })
    expect(stopTrack).toHaveBeenCalled()
  })
  it('请求时关掉回声消除、降噪与自动增益', async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream)
    const { deps } = fakeEnv({ gum })
    await openMic(deps)
    expect(gum).toHaveBeenCalledWith(MIC_CONSTRAINTS)
    expect(MIC_CONSTRAINTS).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  })
})

describe('openMic：setNoiseRms', () => {
  it('不校准直接设定噪声基线，capture-start 带上它', async () => {
    const { deps, sent } = fakeEnv()
    const mic = await openMic(deps)
    mic.setNoiseRms(0.03)
    expect(mic.noiseRms).toBe(0.03)
    mic.start(() => {})
    expect(sent.find((m) => m.type === 'capture-start')).toMatchObject({ noiseRms: 0.03 })
  })
})

describe('openMic：会话', () => {
  it('帧从 worklet 转发给 Worker', async () => {
    const { deps, nodePort, sent } = fakeEnv()
    await openMic(deps)
    const samples = new Float32Array(4)
    nodePort.onmessage?.({ data: { type: 'frame', samples, atSec: 0, sampleRate: 48000 } })
    expect(sent.at(-1)).toMatchObject({ type: 'frame', samples })
  })

  it('校准：发起止消息，记住 Worker 回的噪声基线', async () => {
    const { deps, sent, worker } = fakeEnv()
    const mic = await openMic(deps)
    const p = mic.calibrate(3)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent.map((m) => m.type)).toEqual(['calibrate-start', 'calibrate-end'])
    worker.reply({ type: 'calibrated', noiseRms: 0.01 })
    expect(await p).toBe(0.01)
    expect(mic.noiseRms).toBe(0.01)
  })

  it('收音：start 带噪声基线，segment 回调，stop 返回全部段', async () => {
    const { deps, sent, worker } = fakeEnv()
    const mic = await openMic(deps)
    const seen: number[] = []
    mic.start((s) => seen.push(s.medianHz))
    expect(sent.at(-1)).toEqual({ type: 'capture-start', noiseRms: 0 })
    const seg = { startSec: 0, endSec: 0.5, medianHz: 262 }
    worker.reply({ type: 'segment', segment: seg })
    expect(seen).toEqual([262])
    const p = mic.stop()
    expect(sent.at(-1)).toEqual({ type: 'capture-stop' })
    worker.reply({ type: 'stopped', segments: [seg] })
    expect(await p).toEqual([seg])
  })

  it('没 start 就 stop：直接返回空', async () => {
    const { deps } = fakeEnv()
    const mic = await openMic(deps)
    expect(await mic.stop()).toEqual([])
  })

  it('close 停音轨、断开节点、终止 Worker', async () => {
    const { deps, node, worker, stopTrack } = fakeEnv()
    const mic = await openMic(deps)
    mic.close()
    expect(stopTrack).toHaveBeenCalled()
    expect(node.disconnect).toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalled()
  })
})

describe('openMic：Worker 出错', () => {
  it('calibrate 进行中 Worker 触发 onerror → 以 reason error 拒绝', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    const p = mic.calibrate(3)
    const caught = p.catch((x) => x)
    await new Promise((r) => setTimeout(r, 0))
    worker.onerror?.(new Error('boom'))
    const e = await caught
    expect(e).toBeInstanceOf(MicError)
    expect(e.reason).toBe('error')
    expect(e.message).toBe('Worker 出错')
  })

  it('stop 进行中出错 → 拒绝；出错之后的 calibrate 与 stop 同样拒绝', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    mic.start(() => {})
    const p = mic.stop()
    const caught = p.catch((x) => x)
    worker.onerror?.(new Error('boom'))
    expect(await caught).toMatchObject({ reason: 'error' })
    await expect(mic.calibrate(1)).rejects.toMatchObject({ reason: 'error' })
    mic.start(() => {})
    await expect(mic.stop()).rejects.toMatchObject({ reason: 'error' })
  })
})

describe('openMic：加固（复审一轮）', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const seg = (hz: number) => ({ startSec: 0, endSec: 0.5, medianHz: hz })

  it('connectSource 抛错 → error，并停音轨', async () => {
    const { deps, stopTrack } = fakeEnv()
    const e = await openMic({ ...deps, connectSource: () => { throw new Error('x') } }).catch((x) => x)
    expect(e).toBeInstanceOf(MicError)
    expect(e.reason).toBe('error')
    expect(stopTrack).toHaveBeenCalled()
  })

  it('createWorker 抛错 → error，停音轨并断开节点', async () => {
    const { deps, stopTrack, node } = fakeEnv()
    const e = await openMic({ ...deps, createWorker: () => { throw new Error('x') } }).catch((x) => x)
    expect(e.reason).toBe('error')
    expect(stopTrack).toHaveBeenCalled()
    expect(node.disconnect).toHaveBeenCalled()
  })

  it('校准进行中 close：calibrate 拒绝，之后的 stop 也拒绝', async () => {
    const { deps } = fakeEnv()
    const mic = await openMic(deps)
    const caught = mic.calibrate(3).catch((x) => x)
    await tick()
    mic.close()
    expect(await caught).toMatchObject({ reason: 'error', message: '麦克风已关闭' })
    await expect(mic.stop()).rejects.toMatchObject({ reason: 'error' })
    await expect(mic.calibrate()).rejects.toMatchObject({ reason: 'error' })
  })

  it('close 两次不抛错', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    mic.close()
    expect(() => mic.close()).not.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('并发 calibrate 共享同一次校准', async () => {
    const { deps, sent, worker } = fakeEnv()
    const mic = await openMic(deps)
    const a = mic.calibrate(3)
    const b = mic.calibrate(3)
    await tick()
    expect(sent.map((m) => m.type)).toEqual(['calibrate-start', 'calibrate-end'])
    worker.reply({ type: 'calibrated', noiseRms: 0.02 })
    expect(await Promise.all([a, b])).toEqual([0.02, 0.02])
  })

  it('两次 stop 按 FIFO 对应两条 stopped', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    mic.start(() => {})
    const p1 = mic.stop()
    mic.start(() => {})
    const p2 = mic.stop()
    worker.reply({ type: 'stopped', segments: [seg(100)] })
    worker.reply({ type: 'stopped', segments: [seg(200)] })
    expect(await p1).toEqual([seg(100)])
    expect(await p2).toEqual([seg(200)])
  })

  it('stop 未决时 start(cb2)：旧段不投递，新段投递，cb2 不被旧 stop 清掉', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    mic.start(() => {})
    const p1 = mic.stop()
    const seen: number[] = []
    mic.start((s) => seen.push(s.medianHz))
    worker.reply({ type: 'segment', segment: seg(111) })
    expect(seen).toEqual([])
    worker.reply({ type: 'stopped', segments: [] })
    await p1
    worker.reply({ type: 'segment', segment: seg(222) })
    expect(seen).toEqual([222])
  })

  it('重复 stop（无新 start）返回同一个 promise', async () => {
    const { deps, worker } = fakeEnv()
    const mic = await openMic(deps)
    mic.start(() => {})
    const p1 = mic.stop()
    const p2 = mic.stop()
    expect(p2).toBe(p1)
    worker.reply({ type: 'stopped', segments: [seg(1)] })
    expect(await p1).toEqual([seg(1)])
  })

  it('stop 未决时 Worker onerror：stop 拒绝，音轨被释放', async () => {
    const { deps, worker, stopTrack } = fakeEnv()
    const mic = await openMic(deps)
    mic.start(() => {})
    const caught = mic.stop().catch((x) => x)
    worker.onerror?.(new Error('boom'))
    expect(await caught).toMatchObject({ reason: 'error', message: 'Worker 出错' })
    expect(stopTrack).toHaveBeenCalled()
  })
})
