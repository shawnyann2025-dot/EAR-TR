import type { PlaybackPlan, PlayOptions } from '../music/playback'
import { planToVoices, trimContextTails, type Voice } from './voices'

/** 总输出衰减，避免多声部叠加削波 */
const MASTER_GAIN = 0.6
const DEFAULT_DELAY_SEC = 0.12

/**
 * 唯一接触 Web Audio API 的地方。它不懂乐理，只执行 PlaybackPlan。
 * 所有时刻均基于 ctx.currentTime——绝不使用 Date.now()（spec §11）。
 */
export class AudioEngine {
  private active: { disconnect(): void }[] = []

  constructor(private readonly ctx: AudioContext) {}

  get currentTime(): number {
    return this.ctx.currentTime
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      await this.ctx.resume()
    }
  }

  play(
    plan: PlaybackPlan,
    delaySec: number = DEFAULT_DELAY_SEC,
    opts: PlayOptions = {},
  ): { startSec: number; endSec: number } {
    const startSec = this.ctx.currentTime + delaySec
    let voices = planToVoices(plan, startSec)
    if (opts.cutContextAtSec !== undefined) {
      voices = trimContextTails(voices, startSec + opts.cutContextAtSec)
    }
    for (const voice of voices) this.spawn(voice)
    return { startSec, endSec: voices.reduce((max, v) => Math.max(max, v.stopSec), startSec) }
  }

  get state(): AudioContextState {
    return this.ctx.state
  }

  /** 输出延迟（秒）：outputLatency → baseLatency → 0（P-3 spec §6.5） */
  get outputLatencySec(): number {
    const o = (this.ctx as { outputLatency?: number }).outputLatency
    if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o
    const b = (this.ctx as { baseLatency?: number }).baseLatency
    return typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0
  }

  /** 监听 AudioContext 状态变化（被系统挂起即视为中断，P-3 spec §6.6） */
  onStateChange(fn: (state: AudioContextState) => void): () => void {
    const handler = () => fn(this.ctx.state)
    this.ctx.addEventListener('statechange', handler)
    return () => this.ctx.removeEventListener('statechange', handler)
  }

  /** 仍在 active 中的节点数（FWD-1：已结束的节点应已移除） */
  get activeCount(): number {
    return this.active.length
  }

  private release(nodes: { disconnect(): void }[]): void {
    for (const node of nodes) {
      try {
        node.disconnect()
      } catch {
        // 已断开，忽略
      }
    }
    this.active = this.active.filter((n) => !nodes.includes(n))
  }

  stopAll(): void {
    for (const node of this.active) {
      try {
        node.disconnect()
      } catch {
        // 节点可能已自行结束并断开，忽略
      }
    }
    this.active = []
  }

  dispose(): void {
    this.stopAll()
    void this.ctx.close()
  }

  private spawn(voice: Voice): void {
    const { env } = voice.timbre
    const amp = this.ctx.createGain()
    amp.connect(this.ctx.destination)
    this.active.push(amp)

    const peak = voice.gain * MASTER_GAIN
    const sustainLevel = peak * env.sustain
    // 包络断点钳制为单调不减且不超过 stopSec——短音符 + 长衰减音色（如 piano）下，
    // 未钳制的 decayEnd 可能晚于 stopSec，导致后续自动化事件时刻倒挂（行为未定义，实测为不淡出）。
    const attackEnd = Math.min(voice.startSec + env.attackSec, voice.stopSec)
    const decayEnd = Math.min(attackEnd + env.decaySec, voice.stopSec)
    const releaseStart = Math.min(
      Math.max(decayEnd, voice.stopSec - env.releaseSec),
      voice.stopSec,
    )

    amp.gain.setValueAtTime(0, voice.startSec)
    amp.gain.linearRampToValueAtTime(peak, attackEnd)
    amp.gain.linearRampToValueAtTime(sustainLevel, decayEnd)
    amp.gain.setValueAtTime(sustainLevel, releaseStart)
    amp.gain.linearRampToValueAtTime(0, voice.stopSec)

    const voiceNodes: { disconnect(): void }[] = [amp]
    let remaining = voice.timbre.partials.length
    for (const partial of voice.timbre.partials) {
      const osc = this.ctx.createOscillator()
      osc.type = voice.timbre.oscType
      osc.frequency.setValueAtTime(voice.freqHz * partial.ratio, voice.startSec)

      const partialGain = this.ctx.createGain()
      partialGain.gain.setValueAtTime(partial.gain, voice.startSec)

      osc.connect(partialGain)
      partialGain.connect(amp)
      osc.start(voice.startSec)
      osc.stop(voice.stopSec)

      this.active.push(osc, partialGain)
      voiceNodes.push(osc, partialGain)
      osc.onended = () => {
        remaining--
        // FWD-1：该音的最后一个分音结束时，释放该音全部节点并移出 active
        if (remaining === 0) this.release(voiceNodes)
      }
    }
  }
}

/**
 * 创建引擎。必须在用户手势的调用栈内调用——iOS Safari 要求
 * AudioContext 由用户手势启动（spec §11）。
 */
export function createAudioEngine(): AudioEngine {
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    throw new Error('此浏览器不支持 Web Audio，无法播放。')
  }
  return new AudioEngine(new Ctor())
}
