import { createPitchPipeline, type PipelineIn } from './pitchPipeline'

/** Worker 入口（浏览器专用，不单测）：把消息交给纯函数管线 */
const pipeline = createPitchPipeline()
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PipelineIn>) => void) | null
  postMessage(m: unknown): void
}
scope.onmessage = (e) => {
  for (const out of pipeline.handle(e.data)) scope.postMessage(out)
}
