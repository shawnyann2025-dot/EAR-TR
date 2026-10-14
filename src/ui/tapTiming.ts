/**
 * 打拍计时（主 spec §11、P-2b §8、P-3 spec §6.5）。
 * 所有时刻都是 AudioContext.currentTime 的秒数——绝不用 Date.now()。
 */
export const TAP_WINDOW_GRACE_SEC = 0.3

export interface TapClock {
  /** AudioEngine.play 返回的 startSec */
  playStartSec: number
  /** Exercise.contentStartSec */
  contentStartSec: number
  /** 输出延迟：声音从排程时刻到达耳朵的时间 */
  latencySec: number
}

/** 学习者「听到」题目内容起点的 AudioContext 时刻 */
export function contentZeroCtxSec(c: TapClock): number {
  return c.playStartSec + c.contentStartSec + c.latencySec
}

export function tapsRelativeToContent(tapCtxTimes: readonly number[], c: TapClock): number[] {
  const zero = contentZeroCtxSec(c)
  return tapCtxTimes.map((t) => t - zero)
}

export function tapWindowEndCtxSec(c: TapClock, windowSec: number): number {
  return contentZeroCtxSec(c) + windowSec + TAP_WINDOW_GRACE_SEC
}
