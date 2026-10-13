import type { Segment } from '../pitch/segments'

/** 界面只认这个窄接口；platform.ts 的 createLazyMic 实现它，测试用假实现 */
export interface SingMic {
  /** 打开麦克风并校准噪声基线（首次约 3 秒）；失败抛 MicError */
  ensure(): Promise<void>
  start(onSegment: (s: Segment) => void): Promise<void>
  stop(): Promise<Segment[]>
}

/** P-4 spec §3.2 已知局限：真实短音约 0.45 s 以下可能整段丢失 */
export const SING_HINT = '每个音唱稳约 1 秒'

export function captureTimeoutSec(targetCount: number): number {
  return 3 + 1.5 * targetCount
}
