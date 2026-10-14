import { createSegmenter, type Segment, type Segmenter } from '../pitch/segments'
import { HOP_SIZE, yinFrame } from '../pitch/yin'

/** 噪声基线校准时长（秒），P-4 spec §4.1 */
export const CALIBRATE_SEC = 3

export type PipelineIn =
  | { type: 'calibrate-start' }
  | { type: 'calibrate-end' }
  | { type: 'capture-start'; noiseRms: number }
  | { type: 'capture-stop' }
  | { type: 'frame'; samples: Float32Array; atSec: number; sampleRate: number }

export type PipelineOut =
  | { type: 'calibrated'; noiseRms: number }
  | { type: 'segment'; segment: Segment }
  | { type: 'stopped'; segments: Segment[] }

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function rmsOf(samples: Float32Array): number {
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0
}

/** Worker 里的处理核心：纯函数式的消息处理，零 IO */
export function createPitchPipeline() {
  let mode: 'idle' | 'calibrating' | 'capturing' = 'idle'
  let rmsSamples: number[] = []
  let noiseRms = 0
  let seg: Segmenter | null = null
  let segHop = 0

  return {
    handle(msg: PipelineIn): PipelineOut[] {
      switch (msg.type) {
        case 'calibrate-start':
          mode = 'calibrating'
          rmsSamples = []
          return []
        case 'calibrate-end':
          mode = 'idle'
          return [{ type: 'calibrated', noiseRms: median(rmsSamples) }]
        case 'capture-start':
          mode = 'capturing'
          noiseRms = msg.noiseRms
          seg = null
          return []
        case 'capture-stop': {
          mode = 'idle'
          if (!seg) return [{ type: 'stopped', segments: [] }]
          const tail = seg.flush()
          const out: PipelineOut[] = tail ? [{ type: 'segment', segment: tail }] : []
          out.push({ type: 'stopped', segments: seg.segments() })
          seg = null
          return out
        }
        case 'frame': {
          if (mode === 'calibrating') {
            rmsSamples.push(rmsOf(msg.samples))
            return []
          }
          if (mode !== 'capturing') return []
          const f = yinFrame(msg.samples, msg.sampleRate)
          const hopSec = HOP_SIZE / msg.sampleRate
          if (!seg || segHop !== hopSec) {
            seg = createSegmenter({ noiseRms, hopSec })
            segHop = hopSec
          }
          const closed = seg.push(f, msg.atSec)
          return closed ? [{ type: 'segment', segment: closed }] : []
        }
      }
    },
  }
}
