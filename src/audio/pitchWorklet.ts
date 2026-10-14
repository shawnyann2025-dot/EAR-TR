import { createFrameSlicer } from './frameSlicer'

/**
 * AudioWorklet 入口（浏览器专用，不单测）：只切帧转发，不做分析（P-4 spec §4.1）。
 * 由 Vite 以 `?worker&url` 打包后交给 audioWorklet.addModule。
 */
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class PitchFrameProcessor extends AudioWorkletProcessor {
  private slicer = createFrameSlicer()

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (ch) {
      for (const f of this.slicer.push(ch)) {
        this.port.postMessage({ type: 'frame', samples: f.frame, atSec: f.startSample / sampleRate, sampleRate }, [f.frame.buffer])
      }
    }
    return true
  }
}

registerProcessor('pitch-frames', PitchFrameProcessor)
