// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Segment } from '../../pitch/segments'
import { SING_HINT, captureTimeoutSec, type SingMic } from '../singMic'
import { SingDetectControl, STOP_WATCHDOG_SEC } from './SingDetectControl'

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

const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })

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

function manualSchedule() {
  const items: { sec: number; fn: () => void; live: boolean }[] = []
  const schedule = (sec: number, fn: () => void) => {
    const it = { sec, fn, live: true }
    items.push(it)
    return () => { it.live = false }
  }
  const fire = (sec?: number) => items.filter((i) => i.live && (sec === undefined || i.sec === sec)).forEach((i) => i.fn())
  return { schedule, items, fire }
}
const base = { targetsText: 'do', targetCount: 1, onPlayTarget: vi.fn() }

describe('SingDetectControl：start/stop 顺序与回退（评审 I-1 / I-2 / M-1）', () => {
  it('start 被拒：超时不提交；自评仍能作答且只提交一次', async () => {
    const mic = fakeMic({ startFails: true })
    const onResponse = vi.fn()
    const sch = manualSchedule()
    render(<SingDetectControl {...base} enabled mic={mic} schedule={sch.schedule} onResponse={onResponse} />)
    await flush()
    expect(screen.getByText(/收音出错/)).toBeTruthy()
    sch.fire()
    await flush()
    expect(onResponse).not.toHaveBeenCalled()
    expect(mic.stops).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '听目标' }))
    fireEvent.click(screen.getByRole('button', { name: '唱对了' }))
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith({ kind: 'pitch', selfAssessedCorrect: true })
  })

  it('start 迟到：先显示准备收音…，唱完了禁用，resolve 后才开始计时', async () => {
    let resolveStart!: () => void
    const mic = fakeMic()
    mic.start = () => new Promise<void>((r) => { resolveStart = r })
    const sch = manualSchedule()
    render(<SingDetectControl {...base} targetCount={2} enabled mic={mic} schedule={sch.schedule} onResponse={vi.fn()} />)
    await flush()
    expect(screen.getByText('准备收音…')).toBeTruthy()
    expect(screen.getByRole('button', { name: '唱完了' })).toHaveProperty('disabled', true)
    expect(sch.items.length).toBe(0)
    await act(async () => { resolveStart() })
    await flush()
    expect(screen.getByText(/正在听/)).toBeTruthy()
    expect(sch.items.map((i) => i.sec)).toEqual([6])
    expect(screen.getByRole('button', { name: '唱完了' })).toHaveProperty('disabled', false)
  })

  it('start 未落定时卸载：不发 stop，落定后恰好一次', async () => {
    let resolveStart!: () => void
    const mic = fakeMic()
    mic.start = () => new Promise<void>((r) => { resolveStart = r })
    const onResponse = vi.fn()
    const { unmount } = render(<SingDetectControl {...base} enabled mic={mic} schedule={() => () => {}} onResponse={onResponse} />)
    await flush()
    unmount()
    await flush()
    expect(mic.stops).toBe(0)
    await act(async () => { resolveStart() })
    await flush()
    expect(mic.stops).toBe(1)
    expect(onResponse).not.toHaveBeenCalled()
  })

  it('stop 一直不落定：看门狗到点改为自评，迟到的结果被忽略', async () => {
    let resolveStop!: (s: Segment[]) => void
    const mic = fakeMic()
    mic.stop = () => new Promise<Segment[]>((r) => { resolveStop = r })
    const onResponse = vi.fn()
    const sch = manualSchedule()
    render(<SingDetectControl {...base} enabled mic={mic} schedule={sch.schedule} onResponse={onResponse} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '唱完了' }))
    await flush()
    expect(sch.items.some((i) => i.live && i.sec === STOP_WATCHDOG_SEC)).toBe(true)
    act(() => sch.fire(STOP_WATCHDOG_SEC))
    await flush()
    expect(screen.getByText(/收音出错，本题改为自评/)).toBeTruthy()
    await act(async () => { resolveStop([{ startSec: 0, endSec: 1, medianHz: 262 }]) })
    await flush()
    expect(onResponse).not.toHaveBeenCalled()
  })

  it('finish 后 stop 被拒：显示回退，不提交', async () => {
    const mic = fakeMic()
    mic.stop = async () => { throw new Error('x') }
    const onResponse = vi.fn()
    render(<SingDetectControl {...base} enabled mic={mic} schedule={() => () => {}} onResponse={onResponse} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '唱完了' }))
    await flush()
    expect(screen.getByText(/收音出错/)).toBeTruthy()
    expect(onResponse).not.toHaveBeenCalled()
  })
})
