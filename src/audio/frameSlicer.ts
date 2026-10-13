import { FRAME_SIZE, HOP_SIZE } from '../pitch/yin'

export interface SlicedFrame {
  frame: Float32Array
  /** 帧首样本的全局序号 */
  startSample: number
}

/**
 * 把音频线程送来的小块（通常 128 样本）切成 YIN 帧（2048 / hop 512）。纯函数，零 IO。
 * 跑在 AudioWorklet 里：只做拷贝与计数，不做任何分析（P-4 spec §4.1）。
 */
export function createFrameSlicer(frameSize: number = FRAME_SIZE, hop: number = HOP_SIZE) {
  const ring = new Float32Array(frameSize)
  let total = 0
  let nextEmitAt = frameSize
  return {
    push(block: Float32Array): SlicedFrame[] {
      const out: SlicedFrame[] = []
      for (let i = 0; i < block.length; i++) {
        ring[total % frameSize] = block[i]
        total++
        if (total === nextEmitAt) {
          const frame = new Float32Array(frameSize)
          const start = total - frameSize
          for (let k = 0; k < frameSize; k++) frame[k] = ring[(start + k) % frameSize]
          out.push({ frame, startSample: start })
          nextEmitAt += hop
        }
      }
      return out
    },
  }
}
