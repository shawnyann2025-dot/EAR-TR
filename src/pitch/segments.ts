import { framesOf } from './synth'
import { HOP_SIZE, SAMPLE_RATE, YIN_THRESHOLD, yinFrame, type PitchFrame } from './yin'

export const VOICED_RMS_FACTOR = 2
export const SEGMENT_JUMP_CENTS = 80
export const SEGMENT_JITTER_CENTS = 30
export const MIN_SEGMENT_SEC = 0.15
export const GAP_SEC = 0.06
/** 段内落在中位数 ±SEGMENT_JITTER_CENTS 内的帧至少占这么多 */
export const STABLE_FRACTION = 0.8
/**
 * 文档性常量：与当前段中位数相差整数个八度（±SEGMENT_JUMP_CENTS 内）的有声帧，
 * 先折回该八度再计入当前段，不切段。真实人声二次谐波强时 YIN 偶尔单帧报 2f0 或 f0/2。
 */
export const OCTAVE_FOLD_IN_SEGMENT = true

export interface Segment {
  startSec: number
  endSec: number
  medianHz: number
}

export function isVoiced(f: PitchFrame, noiseRms: number): boolean {
  return f.f0Hz !== null && f.aperiodicity <= YIN_THRESHOLD && f.rms >= VOICED_RMS_FACTOR * noiseRms
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

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

export function createSegmenter(opts: { noiseRms?: number; hopSec?: number } = {}): Segmenter {
  const noiseRms = opts.noiseRms ?? 0
  const hopSec = opts.hopSec ?? HOP_SIZE / SAMPLE_RATE
  let run: { atSec: number; hz: number }[] = []
  let lastVoicedAt = -Infinity
  const done: Segment[] = []

  const close = (): Segment | null => {
    const frames = run
    run = []
    if (frames.length === 0) return null
    const m = median(frames.map((f) => f.hz))
    const stable = frames.filter((f) => Math.abs(cents(f.hz, m)) <= SEGMENT_JITTER_CENTS)
    if (stable.length < STABLE_FRACTION * frames.length) return null
    if (stable.length * hopSec < MIN_SEGMENT_SEC - 1e-9) return null
    const seg: Segment = {
      startSec: frames[0].atSec,
      endSec: frames[frames.length - 1].atSec + hopSec,
      medianHz: median(stable.map((f) => f.hz)),
    }
    done.push(seg)
    return seg
  }

  return {
    push(frame, atSec) {
      if (!isVoiced(frame, noiseRms)) {
        if (run.length > 0 && atSec - lastVoicedAt >= GAP_SEC - 1e-9) return close()
        return null
      }
      let hz = frame.f0Hz as number
      let closed: Segment | null = null
      if (run.length > 0) {
        const m = median(run.map((f) => f.hz))
        let c = cents(hz, m)
        if (Math.abs(c) > SEGMENT_JUMP_CENTS) {
          const k = Math.round(c / 1200)
          if (k !== 0 && Math.abs(c - 1200 * k) <= SEGMENT_JUMP_CENTS) {
            hz = hz / Math.pow(2, k)
            c = cents(hz, m)
          }
        }
        if (Math.abs(c) > SEGMENT_JUMP_CENTS || atSec - lastVoicedAt >= GAP_SEC - 1e-9) closed = close()
      }
      run.push({ atSec, hz })
      lastVoicedAt = atSec
      return closed
    },
    flush: close,
    segments: () => [...done],
  }
}

export function segmentSignal(signal: Float32Array, opts: { noiseRms?: number } = {}): Segment[] {
  const seg = createSegmenter({ noiseRms: opts.noiseRms })
  for (const { atSec, frame } of framesOf(signal)) seg.push(yinFrame(frame), atSec)
  seg.flush()
  return seg.segments()
}
