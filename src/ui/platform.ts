import { createAudioEngine, type AudioEngine } from '../audio/AudioEngine'
import { MicError, type MicFailure, type MicSession } from '../audio/micCapture'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PlaybackPlan, PlayOptions } from '../music/playback'
import { createRuntime, type AudioPort, type Runtime, type TimerPort } from '../runtime/runtime'
import { localDateString } from '../session/time'
import { deleteIndexedDb, openIndexedDbRepository } from '../storage/indexeddb'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError, type Repository } from '../storage/types'
import type { EnsureOpts, SingMic } from './singMic'

/**
 * 唯一的组装点（P-3b）：打开存储（失败降级）、懒创建音频、浏览器计时器 → Runtime。
 * 只有这里可以 import 音频引擎与存储实现。
 */

export interface LazyAudio extends AudioPort {
  /** 必须在用户手势里调用（iOS） */
  unlock(): Promise<void>
  readonly ready: boolean
  readonly latencySec: number
  /** 未解锁时为 null */
  readonly context: AudioContext | null
  /** 未解锁时为 'none'（视为未中断） */
  readonly state: AudioContextState | 'none'
  onStateChange(fn: (state: AudioContextState) => void): () => void
}

export function createLazyAudio(factory: () => AudioEngine = createAudioEngine): LazyAudio {
  let engine: AudioEngine | null = null
  const listeners = new Set<(s: AudioContextState) => void>()
  const offs = new Map<(s: AudioContextState) => void, () => void>()
  const need = (): AudioEngine => {
    if (!engine) throw new Error('音频尚未启用')
    return engine
  }
  return {
    async unlock() {
      if (!engine) {
        engine = factory()
        for (const fn of listeners) offs.set(fn, engine.onStateChange(fn))
      }
      await engine.resume()
    },
    get ready() {
      return engine !== null
    },
    get state() {
      return engine ? engine.state : 'none'
    },
    get context() {
      return engine ? engine.context : null
    },
    get latencySec() {
      return engine ? engine.outputLatencySec : 0
    },
    get currentTime() {
      return engine ? engine.currentTime : 0
    },
    play(plan: PlaybackPlan, opts?: PlayOptions) {
      return need().play(plan, undefined, opts)
    },
    stopAll() {
      engine?.stopAll()
    },
    onStateChange(fn) {
      listeners.add(fn)
      if (engine) offs.set(fn, engine.onStateChange(fn))
      return () => {
        listeners.delete(fn)
        offs.get(fn)?.()
        offs.delete(fn)
      }
    },
  }
}

export interface LazyMic extends SingMic {
  readonly failure: MicFailure | null
  close(): void
}

export function createLazyMic(audio: LazyAudio, open?: (ctx: AudioContext) => Promise<MicSession>): LazyMic {
  let session: MicSession | null = null
  let opening: Promise<MicSession> | null = null
  let calibrated = false
  let calibrating: Promise<void> | null = null
  let lastNoiseRms: number | null = null
  let failure: MicFailure | null = null
  /** close() 每调用一次加一：在它之前发起的打开，到达时作废（关闭并丢弃） */
  let gen = 0
  const opener = open ?? ((ctx: AudioContext) => import('./micPlatform').then((m) => m.openBrowserMic(ctx)))

  /** 丢弃一个已死（或要放弃）的会话，下一次 ensure/start 会重开 */
  function drop(s: MicSession): void {
    try {
      s.close()
    } catch {
      /* 已关 */
    }
    if (session === s) {
      session = null
      opening = null
      calibrated = false
      calibrating = null
    }
  }

  async function ensureSession(opts: EnsureOpts = {}): Promise<MicSession> {
    const wantCal = opts.calibrate ?? true
    const g = gen
    if (!session) {
      const ctx = audio.context
      if (!ctx) throw new Error('音频尚未启用')
      if (!opening) {
        const mine: Promise<MicSession> = (async () => {
          const s = await opener(ctx)
          if (g !== gen) {
            s.close()
            throw new MicError('error', '麦克风已关闭')
          }
          s.setNoiseRms(lastNoiseRms ?? 0)
          session = s
          calibrated = false
          return s
        })()
        opening = mine
        mine.catch(() => {
          if (opening === mine) opening = null
        })
      }
      try {
        await opening
        failure = null
      } catch (e) {
        if (g === gen) failure = e instanceof MicError ? e.reason : 'error'
        throw e
      }
    }
    const s = session
    if (!s) throw new MicError('error', '麦克风已关闭')
    if (wantCal && !calibrated) {
      opts.onCalibrating?.()
      if (!calibrating) {
        const p: Promise<void> = s.calibrate().then(
          (n) => {
            if (session === s) {
              lastNoiseRms = n
              calibrated = true
            }
            if (calibrating === p) calibrating = null
          },
          (e) => {
            if (calibrating === p) calibrating = null
            drop(s)
            failure = e instanceof MicError ? e.reason : 'error'
            throw e
          },
        )
        calibrating = p
      }
      await calibrating
    }
    return s
  }

  return {
    get failure() {
      return failure
    },
    async ensure(opts) {
      await ensureSession(opts)
    },
    async start(onSegment) {
      // 题中不校准（用户可能正要开口），沿用上一次的基线；仅在会话的 start() 已执行后才 resolve
      const s = await ensureSession({ calibrate: false })
      try {
        s.start(onSegment)
      } catch (e) {
        drop(s)
        throw e
      }
    },
    async stop() {
      const s = session
      if (!s) return []
      try {
        return await s.stop()
      } catch (e) {
        drop(s)
        throw e
      }
    },
    close() {
      gen++
      const s = session
      session = null
      opening = null
      calibrated = false
      calibrating = null
      try {
        s?.close()
      } catch {
        /* 已关 */
      }
    },
  }
}

/** 生成 id。crypto.randomUUID 仅在安全上下文（https/localhost）可用，局域网 http 下需降级 */
export function newId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export const browserTimer: TimerPort = {
  after(seconds, fn) {
    const id = setTimeout(fn, seconds * 1000)
    return () => clearTimeout(id)
  },
}

export type BootResult =
  | { kind: 'ready'; runtime: Runtime; audio: LazyAudio; mic: LazyMic; storageWarning: string | null }
  | { kind: 'corrupt'; message: string; rawDump: string; rebuild: () => Promise<BootResult> }

export interface BootDeps {
  openRepo?: () => Promise<Repository>
  deleteDb?: () => Promise<void>
  audio?: LazyAudio
  mic?: LazyMic
  timer?: TimerPort
  now?: () => Date
  randomId?: () => string
}

export async function boot(deps: BootDeps = {}): Promise<BootResult> {
  const openRepo = deps.openRepo ?? (() => openIndexedDbRepository())
  const deleteDb = deps.deleteDb ?? (() => deleteIndexedDb())
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? newId

  let repo: Repository
  let storageWarning: string | null = null
  try {
    repo = await openRepo()
  } catch (e) {
    if (e instanceof StorageUnavailableError) {
      repo = new MemoryRepository()
      storageWarning = '本地存储不可用：本次练习的进度不会保存（可在设置里导出备份）'
    } else if (e instanceof StorageCorruptError) {
      return {
        kind: 'corrupt',
        message: e.message,
        rawDump: e.rawDump,
        rebuild: async () => {
          await deleteDb()
          return boot(deps)
        },
      }
    } else {
      throw e
    }
  }

  const audio = deps.audio ?? createLazyAudio()
  const mic = deps.mic ?? createLazyMic(audio)
  const runtime = createRuntime({
    repo,
    audio,
    timer: deps.timer ?? browserTimer,
    curriculum: buildCurriculum(),
    nowIso: () => now().toISOString(),
    todayLocalDate: () => localDateString(now()),
    newProfileId: randomId,
  })
  return { kind: 'ready', runtime, audio, mic, storageWarning }
}
