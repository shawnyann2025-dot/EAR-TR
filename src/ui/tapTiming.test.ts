import { describe, expect, it } from 'vitest'
import { TAP_WINDOW_GRACE_SEC, contentZeroCtxSec, tapWindowEndCtxSec, tapsRelativeToContent } from './tapTiming'

const clock = { playStartSec: 10, contentStartSec: 2, latencySec: 0.05 }

describe('打拍换算（P-3 spec §6.5）', () => {
  it('零点 = 播放起点 + 内容起点 + 输出延迟', () => {
    expect(contentZeroCtxSec(clock)).toBeCloseTo(12.05)
  })
  it('点击时刻换算成相对内容起点的秒数（声音晚 latency 才到耳朵）', () => {
    expect(tapsRelativeToContent([12.05, 12.55, 13.1], clock).map((x) => +x.toFixed(3))).toEqual([0, 0.5, 1.05])
  })
  it('内容开始前的点击为负数，原样保留交给判定', () => {
    expect(tapsRelativeToContent([11.95], clock)[0]).toBeCloseTo(-0.1)
  })
  it('窗口结束 = 零点 + windowSec + 宽限 0.3', () => {
    expect(TAP_WINDOW_GRACE_SEC).toBe(0.3)
    expect(tapWindowEndCtxSec(clock, 4)).toBeCloseTo(16.35)
  })
})
