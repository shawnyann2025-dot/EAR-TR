import { framesOf } from './synth'
import { HOP_SIZE, SAMPLE_RATE, YIN_THRESHOLD, yinFrame, type PitchFrame } from './yin'

export const VOICED_RMS_FACTOR = 2
export const SEGMENT_JUMP_CENTS = 80
export const SEGMENT_JITTER_CENTS = 30
export const MIN_SEGMENT_SEC = 0.15
export const GAP_SEC = 0.06
/** 真实 YIN 八度误判落在恰好 2× 附近几音分内；须小于 1200 − (1100+50) = 50，才不吞掉 do→ti（+25 音分） */
export const OCTAVE_FOLD_TOLERANCE_CENTS = 35
/** 稳定性判断前的音高平滑窗口，约一个颤音周期 */
export const SMOOTH_SEC = 0.18
/** 偏离中位数 >SEGMENT_JUMP_CENTS 的帧须持续这么久才切段，更短的视为颤音峰或孤立误判 */
export const SPLIT_PERSIST_SEC = 0.09
/** 稳定核内平滑音高的最大线性漂移（音分/秒），超过视为滑音 */
export const MAX_DRIFT_CENTS_PER_SEC = 120

export interface Segment {
  startSec: number
  endSec: number
  medianHz: number
}

export function isVoiced(f: PitchFrame, noiseRms: number): boolean {
  return f.f0Hz !== null && f.aperiodicity <= YIN_THRESHOLD && f.rms >= VOICED_RMS_FACTOR * noiseRms
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

/** 若 hz 与 ref 相差整数个八度（±OCTAVE_FOLD_TOLERANCE_CENTS），折到 ref 所在八度 */
function foldTo(hz: number, ref: number): number {
  const c = cents(hz, ref)
  const k = Math.round(c / 1200)
  if (k !== 0 && Math.abs(c - 1200 * k) <= OCTAVE_FOLD_TOLERANCE_CENTS) return hz / Math.pow(2, k)
  return hz
}

/**
 * 八度稳健的参考音高：
 * 1. 把所有帧折到第一帧所在八度；2. 取折叠后中位数；3. 把它移到含原始帧最多的八度。
 * 八度帧数恰好持平时取较低八度。
 */
function octaveRef(hzs: number[]): number {
  const first = hzs[0]
  const folded = hzs.map((h) => foldTo(h, first))
  const med = median(folded)
  const counts = new Map<number, number>()
  for (let i = 0; i < hzs.length; i++) {
    const o = Math.round(Math.log2(hzs[i] / folded[i]))
    counts.set(o, (counts.get(o) ?? 0) + 1)
  }
  let bestO = 0
  let bestN = -1
  for (const [o, n] of counts) {
    if (n > bestN || (n === bestN && o < bestO)) {
      bestO = o
      bestN = n
    }
  }
  return med * Math.pow(2, bestO)
}

/** Σ_{k=0..m} k² */
const sq = (m: number) => (m * (m + 1) * (2 * m + 1)) / 6

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Segmenter {
  push(frame: PitchFrame, atSec: number): Segment | null
  flush(): Segment | null
  segments(): Segment[]
}

interface Fr {
  atSec: number
  hz: number
}

export function createSegmenter(opts: { noiseRms?: number; hopSec?: number } = {}): Segmenter {
  const noiseRms = opts.noiseRms ?? 0
  const hopSec = opts.hopSec ?? HOP_SIZE / SAMPLE_RATE
  let run: Fr[] = []
  let pending: Fr[] = []
  let lastVoicedAt = -Infinity
  const done: Segment[] = []

  const emit = (frames: Fr[]): Segment | null => {
    const n = frames.length
    if (n === 0) return null
    // 八度折叠：以原始中位数所在八度为准
    const ref = octaveRef(frames.map((f) => f.hz))
    const hz = frames.map((f) => foldTo(f.hz, ref))
    const med = median(hz)
    // 平滑（居中滑动平均，边缘截断）
    const w = Math.max(1, Math.round(SMOOTH_SEC / hopSec))
    const half = w >> 1
    const raw = hz.map((h) => cents(h, med))
    const pre = [0]
    for (const c of raw) pre.push(pre[pre.length - 1] + c)
    const sm: number[] = []
    for (let i = 0; i < n; i++) {
      const h = Math.min(half, i, n - 1 - i) // 边缘对称收缩，线性轨迹不被压平
      const lo = i - h
      const hi = i + h
      sm.push((pre[hi + 1] - pre[lo]) / (hi - lo + 1))
    }
    // 最长稳定核：极差 ≤ 2×抖动 且 最小二乘斜率 ≤ 漂移上限
    const ps = [0]
    const pts = [0]
    for (let i = 0; i < n; i++) {
      ps.push(ps[i] + sm[i])
      pts.push(pts[i] + i * hopSec * sm[i])
    }
    // [i..j] 上平滑音高的最小二乘斜率（音分/秒），t = k·hopSec
    const slopeOf = (i: number, j: number): number => {
      const len = j - i + 1
      if (len < 2) return 0
      const sumS = ps[j + 1] - ps[i]
      const sumTS = pts[j + 1] - pts[i]
      const sumT = (hopSec * (i + j) * len) / 2
      const sumTT = hopSec * hopSec * (sq(j) - sq(i - 1))
      const den = len * sumTT - sumT * sumT
      return den > 0 ? (len * sumTS - sumT * sumS) / den : 0
    }
    let bestI = -1
    let bestLen = 0
    for (let i = 0; i < n; i++) {
      let mn = Infinity
      let mx = -Infinity
      for (let j = i; j < n; j++) {
        mn = Math.min(mn, sm[j])
        mx = Math.max(mx, sm[j])
        if (mx - mn > 2 * SEGMENT_JITTER_CENTS) break
        const len = j - i + 1
        if (len <= bestLen) continue
        // 整段及前后两半的斜率都要在上限内：个别被跳变污染的边缘帧不能把滑音的平均斜率拉低
        const mid = i + (len >> 1)
        const ok =
          Math.abs(slopeOf(i, j)) <= MAX_DRIFT_CENTS_PER_SEC &&
          (len < 4 ||
            (Math.abs(slopeOf(i, mid - 1)) <= MAX_DRIFT_CENTS_PER_SEC && Math.abs(slopeOf(mid, j)) <= MAX_DRIFT_CENTS_PER_SEC))
        if (ok) {
          bestI = i
          bestLen = len
        }
      }
    }
    if (bestLen * hopSec < MIN_SEGMENT_SEC - 1e-9) return null
    const seg: Segment = {
      startSec: frames[bestI].atSec,
      endSec: frames[bestI + bestLen - 1].atSec + hopSec,
      medianHz: median(hz.slice(bestI, bestI + bestLen)),
    }
    done.push(seg)
    return seg
  }

  const closeRun = (): Segment | null => {
    run = run.concat(pending)
    pending = []
    const frames = run
    run = []
    return emit(frames)
  }

  return {
    push(frame, atSec) {
      if (!isVoiced(frame, noiseRms)) {
        if ((run.length > 0 || pending.length > 0) && atSec - lastVoicedAt >= GAP_SEC - 1e-9) return closeRun()
        return null
      }
      const fr: Fr = { atSec, hz: frame.f0Hz as number }
      let closed: Segment | null = null
      if (run.length > 0 || pending.length > 0) {
        if (atSec - lastVoicedAt >= GAP_SEC - 1e-9) closed = closeRun()
      }
      lastVoicedAt = atSec
      if (run.length === 0) {
        run.push(fr)
        return closed
      }
      const m = octaveRef(run.map((f) => f.hz))
      const dev = Math.abs(cents(foldTo(fr.hz, m), m))
      if (dev > SEGMENT_JUMP_CENTS) {
        pending.push(fr)
        if (pending[pending.length - 1].atSec - pending[0].atSec + hopSec >= SPLIT_PERSIST_SEC - 1e-9) {
          const frames = run
          run = pending
          pending = []
          closed = emit(frames)
        }
      } else {
        run = run.concat(pending, [fr])
        pending = []
      }
      return closed
    },
    flush: closeRun,
    segments: () => [...done],
  }
}

export function segmentSignal(signal: Float32Array, opts: { noiseRms?: number } = {}): Segment[] {
  const seg = createSegmenter({ noiseRms: opts.noiseRms })
  for (const { atSec, frame } of framesOf(signal)) seg.push(yinFrame(frame), atSec)
  seg.flush()
  return seg.segments()
}
