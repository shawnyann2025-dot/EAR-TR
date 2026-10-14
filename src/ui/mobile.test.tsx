// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInterruptions, useWakeLock } from './mobile'

afterEach(cleanup)

function setVisibility(v: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useWakeLock', () => {
  it('active 时申请；重新可见时再申请；不 active 时释放', async () => {
    const release = vi.fn(async () => {})
    const request = vi.fn(async () => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    function W(p: { on: boolean }) { useWakeLock(p.on); return null }
    const { rerender } = render(<W on />)
    await act(async () => {})
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => { setVisibility('hidden'); setVisibility('visible') })
    expect(request).toHaveBeenCalledTimes(2)
    rerender(<W on={false} />)
    await act(async () => {})
    expect(release).toHaveBeenCalled()
  })

  it('浏览器不支持时不报错', () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined })
    function W() { useWakeLock(true); return null }
    expect(() => render(<W />)).not.toThrow()
  })
})

describe('useInterruptions', () => {
  it('页面隐藏或音频被挂起时触发；不 active 时不触发', () => {
    const handlers: ((s: AudioContextState) => void)[] = []
    const audio = {
      state: 'running' as AudioContextState | 'none',
      onStateChange: (fn: (s: AudioContextState) => void) => {
        handlers.push(fn)
        return () => { handlers.splice(handlers.indexOf(fn), 1) }
      },
    }
    const onInterrupt = vi.fn()
    function I(p: { on: boolean }) { useInterruptions({ active: p.on, audio, onInterrupt }); return null }
    const { rerender } = render(<I on />)
    act(() => setVisibility('hidden'))
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    act(() => handlers.forEach((h) => h('suspended')))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    act(() => handlers.forEach((h) => h('running')))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    rerender(<I on={false} />)
    act(() => setVisibility('hidden'))
    expect(onInterrupt).toHaveBeenCalledTimes(2)
    setVisibility('visible')
  })

  const mk = (state: AudioContextState | 'none') => ({ state, onStateChange: () => () => {} })

  it('激活时页面已隐藏：立即触发', () => {
    const onInterrupt = vi.fn()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    function I() { useInterruptions({ active: true, audio: mk('running'), onInterrupt }); return null }
    render(<I />)
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('激活时音频为 suspended：立即触发；none 或 running 不触发', () => {
    const onInterrupt = vi.fn()
    function I(p: { s: AudioContextState | 'none' }) { useInterruptions({ active: true, audio: mk(p.s), onInterrupt }); return null }
    render(<I s="none" />)
    cleanup()
    render(<I s="running" />)
    expect(onInterrupt).not.toHaveBeenCalled()
    cleanup()
    render(<I s="suspended" />)
    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })
})
