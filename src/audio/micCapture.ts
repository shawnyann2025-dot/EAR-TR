import type { Segment } from '../pitch/segments'
import { CALIBRATE_SEC, type PipelineIn, type PipelineOut } from './pitchPipeline'

export type MicFailure = 'denied' | 'unsupported' | 'error'

export class MicError extends Error {
  constructor(readonly reason: MicFailure, message: string) {
    super(message)
    this.name = 'MicError'
  }
}

export interface PortLike {
  onmessage: ((e: { data: unknown }) => void) | null
  postMessage(m: unknown, transfer?: Transferable[]): void
}
export interface WorkerLike extends PortLike {
  onerror?: ((e: unknown) => void) | null
  terminate(): void
}
export interface MicNode {
  port: PortLike
  disconnect(): void
}

export interface MicDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  /** audioWorklet.addModule(pitchWorklet) */
  loadWorklet(): Promise<void>
  /** MediaStreamSource → AudioWorkletNode('pitch-frames')（→ 静音增益 → destination） */
  connectSource(stream: MediaStream): MicNode
  createWorker(): WorkerLike
  wait(ms: number): Promise<void>
}

/** P-4 spec §4.1：三项浏览器处理全关，否则音高与能量会被改写 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
}

export interface MicSession {
  readonly noiseRms: number
  /** 不校准、直接套用已知的噪声基线（重开会话时复用上一次的校准结果） */
  setNoiseRms(n: number): void
  calibrate(seconds?: number): Promise<number>
  start(onSegment: (s: Segment) => void): void
  stop(): Promise<Segment[]>
  close(): void
}

interface Settler<T> {
  resolve(v: T): void
  reject(e: unknown): void
}

function classify(e: unknown): MicFailure {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unsupported'
  return 'error'
}

export async function openMic(deps: MicDeps): Promise<MicSession> {
  if (!deps.getUserMedia) throw new MicError('unsupported', '此浏览器不支持收音')
  let stream: MediaStream
  try {
    stream = await deps.getUserMedia(MIC_CONSTRAINTS)
  } catch (e) {
    const reason = classify(e)
    throw new MicError(reason, reason === 'denied' ? '没有麦克风权限' : `无法打开麦克风：${String((e as Error)?.message ?? e)}`)
  }
  const stopTracks = () => {
    for (const t of stream.getTracks()) t.stop()
  }
  try {
    await deps.loadWorklet()
  } catch (e) {
    stopTracks()
    throw new MicError('unsupported', `此浏览器不支持 AudioWorklet：${String((e as Error)?.message ?? e)}`)
  }

  let node: MicNode | null = null
  let worker: WorkerLike
  try {
    node = deps.connectSource(stream)
    worker = deps.createWorker()
  } catch (e) {
    stopTracks()
    try {
      node?.disconnect()
    } catch {
      /* 已在失败路径上，忽略 */
    }
    throw new MicError('error', `无法连接麦克风：${String((e as Error)?.message ?? e)}`)
  }
  const micNode = node
  const send = (m: PipelineIn, transfer?: Transferable[]) => worker.postMessage(m, transfer)

  // worklet → Worker：帧原样转发
  micNode.port.onmessage = (e) => {
    const m = e.data as PipelineIn
    if (m.type === 'frame' && !failure) send(m, [m.samples.buffer])
  }

  let noiseRms = 0
  let onSegment: ((s: Segment) => void) | null = null
  let capturing = false
  let startedSinceStop = false
  let failure: MicError | null = null
  let calibrating: Promise<number> | null = null
  let calibEntry: Settler<number> | null = null
  const stoppedQueue: Array<Settler<Segment[]>> = []
  let lastStop: Promise<Segment[]> | null = null
  let stopsInFlight = 0

  function shutdown(err: MicError) {
    if (failure) return
    failure = err
    onSegment = null
    capturing = false
    const c = calibEntry
    calibEntry = null
    c?.reject(err)
    for (const q of stoppedQueue.splice(0)) q.reject(err)
    stopsInFlight = 0
    stopTracks()
    micNode.disconnect()
    worker.terminate()
  }

  worker.onmessage = (e) => {
    const m = e.data as PipelineOut
    if (m.type === 'calibrated') {
      const c = calibEntry
      calibEntry = null
      c?.resolve(m.noiseRms)
    } else if (m.type === 'segment') {
      if (stopsInFlight === 0) onSegment?.(m.segment)
    } else if (m.type === 'stopped') {
      if (stopsInFlight > 0) stopsInFlight--
      stoppedQueue.shift()?.resolve(m.segments)
    }
  }
  worker.onerror = () => shutdown(new MicError('error', 'Worker 出错'))

  async function doCalibrate(seconds: number): Promise<number> {
    const done = new Promise<number>((resolve, reject) => {
      calibEntry = { resolve, reject }
    })
    done.catch(() => {}) // wait 期间出错时避免未处理拒绝；真正的拒绝由 await 抛出
    send({ type: 'calibrate-start' })
    await deps.wait(seconds * 1000)
    if (failure) throw failure
    send({ type: 'calibrate-end' })
    noiseRms = await done
    return noiseRms
  }

  return {
    get noiseRms() {
      return noiseRms
    },
    setNoiseRms(n) {
      noiseRms = n
    },
    calibrate(seconds = CALIBRATE_SEC) {
      if (failure) return Promise.reject(failure)
      if (calibrating) return calibrating
      const p = doCalibrate(seconds).finally(() => {
        calibEntry = null
        if (calibrating === p) calibrating = null
      })
      calibrating = p
      return p
    },
    start(cb) {
      if (failure) return
      onSegment = cb
      capturing = true
      startedSinceStop = true
      send({ type: 'capture-start', noiseRms })
    },
    stop() {
      if (failure) return Promise.reject(failure)
      if (stoppedQueue.length > 0 && !startedSinceStop && lastStop) return lastStop
      if (!capturing) return Promise.resolve([])
      capturing = false
      startedSinceStop = false
      onSegment = null
      stopsInFlight++
      const p = new Promise<Segment[]>((resolve, reject) => {
        const entry: Settler<Segment[]> = { resolve, reject }
        stoppedQueue.push(entry)
      })
      lastStop = p
      send({ type: 'capture-stop' })
      return p
    },
    close() {
      shutdown(new MicError('error', '麦克风已关闭'))
    },
  }
}
