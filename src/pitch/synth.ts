import { makeRng } from '../music/rng'
import { FRAME_SIZE, HOP_SIZE, SAMPLE_RATE } from './yin'

/** 合成信号：测试与验收用。纯函数，确定性 */
export interface Harmonic {
  ratio: number
  amp: number
}

export function tone(
  freqHz: number,
  durSec: number,
  opts: { sampleRate?: number; partials?: Harmonic[]; amp?: number; vibratoCents?: number; vibratoHz?: number } = {},
): Float32Array {
  const sr = opts.sampleRate ?? SAMPLE_RATE
  const partials = opts.partials ?? [{ ratio: 1, amp: 1 }]
  const amp = opts.amp ?? 0.5
  const vibCents = opts.vibratoCents ?? 0
  const vibHz = opts.vibratoHz ?? 5.5
  const total = partials.reduce((s, p) => s + p.amp, 0)
  const n = Math.round(durSec * sr)
  const out = new Float32Array(n)
  let phase = 0 // 基频相位（周期数）
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = freqHz * Math.pow(2, (vibCents * Math.sin(2 * Math.PI * vibHz * t)) / 1200)
    phase += f / sr
    let v = 0
    for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * p.ratio * phase)
    out[i] = (amp * v) / total
  }
  return out
}

/** 相位连续的基频轨迹：hzAt(t) 给出 t 秒处的基频（可含滑音、颤音） */
export function track(hzAt: (tSec: number) => number, durSec: number, opts: { sampleRate?: number; amp?: number } = {}): Float32Array {
  const sr = opts.sampleRate ?? SAMPLE_RATE
  const amp = opts.amp ?? 0.5
  const n = Math.round(durSec * sr)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    phase += hzAt(i / sr) / sr
    out[i] = amp * Math.sin(2 * Math.PI * phase)
  }
  return out
}

/** 相位连续的指数（线性音分）滑音 */
export function glide(fromHz: number, toHz: number, durSec: number, opts: { sampleRate?: number; amp?: number } = {}): Float32Array {
  return track((t) => fromHz * Math.pow(toHz / fromHz, t / durSec), durSec, opts)
}

export function silence(durSec: number, sampleRate: number = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(durSec * sampleRate))
}

export function noise(durSec: number, seed: number, amp = 0.3, sampleRate: number = SAMPLE_RATE): Float32Array {
  const rng = makeRng(seed)
  const out = new Float32Array(Math.round(durSec * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = amp * (rng.next() * 2 - 1)
  return out
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 每 HOP_SIZE 取一帧 FRAME_SIZE；atSec 为帧起点 */
export function framesOf(signal: Float32Array, sampleRate: number = SAMPLE_RATE): { atSec: number; frame: Float32Array }[] {
  const out: { atSec: number; frame: Float32Array }[] = []
  for (let start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    out.push({ atSec: start / sampleRate, frame: signal.subarray(start, start + FRAME_SIZE) })
  }
  return out
}
