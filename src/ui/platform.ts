import { createAudioEngine, type AudioEngine } from '../audio/AudioEngine'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PlaybackPlan, PlayOptions } from '../music/playback'
import { createRuntime, type AudioPort, type Runtime, type TimerPort } from '../runtime/runtime'
import { localDateString } from '../session/time'
import { deleteIndexedDb, openIndexedDbRepository } from '../storage/indexeddb'
import { MemoryRepository } from '../storage/memory'
import { StorageCorruptError, StorageUnavailableError, type Repository } from '../storage/types'

/**
 * 唯一的组装点（P-3b）：打开存储（失败降级）、懒创建音频、浏览器计时器 → Runtime。
 * 只有这里可以 import 音频引擎与存储实现。
 */

export interface LazyAudio extends AudioPort {
  /** 必须在用户手势里调用（iOS） */
  unlock(): Promise<void>
  readonly ready: boolean
  readonly latencySec: number
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

export const browserTimer: TimerPort = {
  after(seconds, fn) {
    const id = setTimeout(fn, seconds * 1000)
    return () => clearTimeout(id)
  },
}

export type BootResult =
  | { kind: 'ready'; runtime: Runtime; audio: LazyAudio; storageWarning: string | null }
  | { kind: 'corrupt'; message: string; rawDump: string; rebuild: () => Promise<BootResult> }

export interface BootDeps {
  openRepo?: () => Promise<Repository>
  deleteDb?: () => Promise<void>
  audio?: LazyAudio
  timer?: TimerPort
  now?: () => Date
  randomId?: () => string
}

export async function boot(deps: BootDeps = {}): Promise<BootResult> {
  const openRepo = deps.openRepo ?? (() => openIndexedDbRepository())
  const deleteDb = deps.deleteDb ?? (() => deleteIndexedDb())
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? (() => crypto.randomUUID())

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
  const runtime = createRuntime({
    repo,
    audio,
    timer: deps.timer ?? browserTimer,
    curriculum: buildCurriculum(),
    nowIso: () => now().toISOString(),
    todayLocalDate: () => localDateString(now()),
    newProfileId: randomId,
  })
  return { kind: 'ready', runtime, audio, storageWarning }
}
