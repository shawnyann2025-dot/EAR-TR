import type { Segment } from '../pitch/segments'

/** 界面只认这个窄接口；platform.ts 的 createLazyMic 实现它，测试用假实现 */
export interface SingMic {
  /** 打开麦克风并校准噪声基线（首次约 3 秒）；失败抛 MicError */
  ensure(opts?: EnsureOpts): Promise<void>
  /**
   * 顺序约定：start() 仅在真正开始收音后才 resolve（打开与校准都发生在此之前）；
   * 调用方必须等 start() 落定（resolve 或 reject）后才可调用 stop()；
   * start() 被拒后无需也不应再 stop()。
   */
  start(onSegment: (s: Segment) => void): Promise<void>
  stop(): Promise<Segment[]>
  /** 释放麦克风（会话结束、离开页面）；之后再 start/ensure 会重新打开 */
  close(): void
}

export interface EnsureOpts {
  /** 默认 true。false：只打开，不校准（题中重开用，沿用上一次的噪声基线） */
  calibrate?: boolean
  /** 麦克风已打开、校准开始之前调用（界面据此提示「请保持安静」） */
  onCalibrating?: () => void
}

/** P-4 spec §3.2 已知局限：真实短音约 0.45 s 以下可能整段丢失 */
export const SING_HINT = '每个音唱稳约 1 秒'

export function captureTimeoutSec(targetCount: number): number {
  return 3 + 1.5 * targetCount
}
