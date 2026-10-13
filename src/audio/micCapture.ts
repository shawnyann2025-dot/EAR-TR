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
  calibrate(seconds?: number): Promise<number>
  start(onSegment: (s: Segment) => void): void
  stop(): Promise<Segment[]>
  close(): void
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

  const node = deps.connectSource(stream)
  const worker = deps.createWorker()
  const send = (m: PipelineIn, transfer?: Transferable[]) => worker.postMessage(m, transfer)

  // worklet → Worker：帧原样转发
  node.port.onmessage = (e) => {
    const m = e.data as PipelineIn
    if (m.type === 'frame') send(m, [m.samples.buffer])
  }

  let noiseRms = 0
  let onSegment: ((s: Segment) => void) | null = null
  let capturing = false
  let pending: { calibrated?: (n: number) => void; stopped?: (s: Segment[]) => void } = {}
  let rejectPending: Array<(e: MicError) => void> = []
  let failure: MicError | null = null

  worker.onmessage = (e) => {
    const m = e.data as PipelineOut
    if (m.type === 'calibrated') pending.calibrated?.(m.noiseRms)
    else if (m.type === 'segment') onSegment?.(m.segment)
    else if (m.type === 'stopped') pending.stopped?.(m.segments)
  }
  worker.onerror = () => {
    failure = new MicError('error', 'Worker 出错')
    const rejects = rejectPending
    rejectPending = []
    for (const r of rejects) r(failure)
  }

  return {
    get noiseRms() {
      return noiseRms
    },
    async calibrate(seconds = CALIBRATE_SEC) {
      if (failure) throw failure
      const done = new Promise<number>((resolve, reject) => {
        pending = { ...pending, calibrated: resolve }
        rejectPending.push(reject)
      })
      done.catch(() => {}) // 等待期间（wait）出错时避免未处理拒绝；真正的拒绝由下面的 await 抛出
      send({ type: 'calibrate-start' })
      await deps.wait(seconds * 1000)
      if (failure) throw failure
      send({ type: 'calibrate-end' })
      noiseRms = await done
      return noiseRms
    },
    start(cb) {
      onSegment = cb
      capturing = true
      send({ type: 'capture-start', noiseRms })
    },
    async stop() {
      if (failure) throw failure
      if (!capturing) return []
      capturing = false
      const done = new Promise<Segment[]>((resolve, reject) => {
        pending = { ...pending, stopped: resolve }
        rejectPending.push(reject)
      })
      send({ type: 'capture-stop' })
      const segs = await done
      onSegment = null
      return segs
    },
    close() {
      stopTracks()
      node.disconnect()
      worker.terminate()
    },
  }
}
