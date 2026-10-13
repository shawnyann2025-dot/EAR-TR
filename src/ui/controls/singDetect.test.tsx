// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Segment } from '../../pitch/segments'
import { SING_HINT, captureTimeoutSec, type SingMic } from '../singMic'
import { SingDetectControl } from './SingDetectControl'

afterEach(cleanup)

function fakeMic(opts: { startFails?: boolean } = {}) {
  let cb: ((s: Segment) => void) | null = null
  const collected: Segment[] = []
  const mic: SingMic & { emit(hz: number): void; stops: number } = {
    stops: 0,
    ensure: async () => {},
    start: async (onSeg) => {
      if (opts.startFails) throw new Error('boom')
      cb = onSeg
    },
    stop: async () => {
      mic.stops++
      cb = null
      return [...collected]
    },
    emit(hz) {
      const s = { startSec: 0, endSec: 1, medianHz: hz }
      collected.push(s)
      cb?.(s)
    },
  }
  return mic
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('SingDetectControl（P-4 spec §4.3）', () => {
  it('captureTimeoutSec = 3 + 1.5 × 目标数', () => {
    expect(captureTimeoutSec(2)).toBe(6)
  })

  it('进入作答即收音；唱满目标数自动提交检测结果', async () => {
    const mic = fakeMic()
    const onResponse = vi.fn()
    render(<SingDetectControl targetsText="do mi" targetCount={2} enabled mic={mic} schedule={() => () => {}} onPlayTarget={vi.fn()} onResponse={onResponse} />)
    await flush()
    expect(screen.getByText(SING_HINT)).toBeTruthy()
    act(() => mic.emit(262))
    expect(screen.getByText(/已听到 1 \/ 2/)).toBeTruthy()
    act(() => mic.emit(330))
    await flush()
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith({ kind: 'pitch', sungHz: [262, 330] })
  })

  it('「唱完了」提前提交；超时也提交；都只提交一次', async () => {
    const mic = fakeMic()
    const onResponse = vi.fn()
    const timers: (() => void)[] = []
    render(<SingDetectControl targetsText="do mi sol" targetCount={3} enabled mic={mic} schedule={(_s, fn) => { timers.push(fn); return () => {} }} onPlayTarget={vi.fn()} onResponse={onResponse} />)
    await flush()
    act(() => mic.emit(262))
    fireEvent.click(screen.getByRole('button', { name: '唱完了' }))
    await flush()
    act(() => timers.forEach((t) => t()))
    await flush()
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith({ kind: 'pitch', sungHz: [262] })
  })

  it('收音出错：本题改为自评控件', async () => {
    const mic = fakeMic({ startFails: true })
    render(<SingDetectControl targetsText="do" targetCount={1} enabled mic={mic} schedule={() => () => {}} onPlayTarget={vi.fn()} onResponse={vi.fn()} />)
    await flush()
    expect(screen.getByText(/收音出错/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '唱对了' })).toBeTruthy()
  })

  it('未进入作答时不收音', async () => {
    const mic = fakeMic()
    const start = vi.spyOn(mic, 'start')
    render(<SingDetectControl targetsText="do" targetCount={1} enabled={false} mic={mic} schedule={() => () => {}} onPlayTarget={vi.fn()} onResponse={vi.fn()} />)
    await flush()
    expect(start).not.toHaveBeenCalled()
  })

  it('StrictMode 重挂：只提交一次，超时按重挂后的定时器，不提前回退', async () => {
    const mic = fakeMic()
    const onResponse = vi.fn()
    const live = new Set<() => void>()
    const schedule = (_s: number, fn: () => void) => { live.add(fn); return () => { live.delete(fn) } }
    render(
      <StrictMode>
        <SingDetectControl targetsText="do mi" targetCount={2} enabled mic={mic} schedule={schedule} onPlayTarget={vi.fn()} onResponse={onResponse} />
      </StrictMode>,
    )
    await flush()
    expect(live.size).toBe(1) // 第一次挂载的定时器已取消
    expect(onResponse).not.toHaveBeenCalled()
    expect(screen.queryByText(/收音出错/)).toBeNull()
    act(() => mic.emit(262))
    act(() => mic.emit(330))
    await flush()
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith({ kind: 'pitch', sungHz: [262, 330] })
  })

  it('完成后 enabled 变 false（进入反馈）：仍提交结果；真正卸载时丢弃结果', async () => {
    const mic = fakeMic()
    const onResponse = vi.fn()
    const props = { targetsText: 'do', targetCount: 1, mic, schedule: () => () => {}, onPlayTarget: vi.fn(), onResponse }
    const { rerender, unmount } = render(<SingDetectControl {...props} enabled />)
    await flush()
    act(() => mic.emit(262))
    rerender(<SingDetectControl {...props} enabled={false} />)
    await flush()
    expect(onResponse).toHaveBeenCalledTimes(1)
    unmount()

    const mic2 = fakeMic()
    const onResponse2 = vi.fn()
    const r2 = render(<SingDetectControl {...props} mic={mic2} onResponse={onResponse2} enabled />)
    await flush()
    r2.unmount()
    await flush()
    expect(mic2.stops).toBe(1)
    expect(onResponse2).not.toHaveBeenCalled()
  })
})
