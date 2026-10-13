import { FRAME_SIZE, HOP_SIZE, SAMPLE_RATE } from './yin'

/** 每 HOP_SIZE 取一帧 FRAME_SIZE；atSec 为帧起点 */
export function framesOf(signal: Float32Array, sampleRate: number = SAMPLE_RATE): { atSec: number; frame: Float32Array }[] {
  const out: { atSec: number; frame: Float32Array }[] = []
  for (let start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    out.push({ atSec: start / sampleRate, frame: signal.subarray(start, start + FRAME_SIZE) })
  }
  return out
}
