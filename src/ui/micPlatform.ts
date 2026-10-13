import workletUrl from '../audio/pitchWorklet.ts?worker&url'
import { openMic, type MicSession, type WorkerLike } from '../audio/micCapture'

/** 浏览器专用：真实的 getUserMedia / AudioWorklet / Worker。只由 platform.ts 动态 import */
export function openBrowserMic(ctx: AudioContext): Promise<MicSession> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  return openMic({
    getUserMedia: md?.getUserMedia ? (c) => md.getUserMedia(c) : undefined,
    loadWorklet: async () => {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet 不可用')
      await ctx.audioWorklet.addModule(workletUrl)
    },
    connectSource: (stream) => {
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'pitch-frames')
      const sink = ctx.createGain()
      sink.gain.value = 0 // 让节点保持被拉动，但不出声
      source.connect(node)
      node.connect(sink).connect(ctx.destination)
      return {
        port: node.port as unknown as WorkerLike,
        disconnect: () => {
          source.disconnect()
          node.disconnect()
          sink.disconnect()
        },
      }
    },
    createWorker: () => new Worker(new URL('../audio/pitchWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
}
