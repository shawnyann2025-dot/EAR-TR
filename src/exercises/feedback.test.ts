import { describe, expect, it } from 'vitest'
import { freqToMidi } from '../music/pitch'
import type { NoteSpec } from '../music/playback'
import { SLOW_FACTOR } from './difficulty'
import { FEEDBACK_ANCHOR_SEC, FEEDBACK_GAP_SEC, buildFeedback } from './feedback'

const content: NoteSpec[] = [
  { midi: 64, atSec: 0, durSec: 0.5, gain: 0.8 },
  { midi: 67, atSec: 0.5, durSec: 0.5, gain: 0.8 },
]
const anchor: NoteSpec[] = [{ midi: 60, atSec: 0, durSec: FEEDBACK_ANCHOR_SEC, gain: 0.8 }]

describe('buildFeedback（主 spec §6.4）', () => {
  it('replay：先放锚点，再放内容；内容整体后移「锚点结束 + 间隔」', () => {
    const { replay } = buildFeedback(content, anchor, 'piano')
    expect(replay.events).toHaveLength(3)
    expect(freqToMidi(replay.events[0].freqHz)).toBeCloseTo(60, 9)
    const offset = FEEDBACK_ANCHOR_SEC + FEEDBACK_GAP_SEC
    expect(replay.events[1].atSec).toBeCloseTo(offset, 12)
    expect(replay.events[2].atSec).toBeCloseTo(offset + 0.5, 12)
  })

  it('contentOffsetSec：内容恰好移动该值，与锚点长度无关', () => {
    const { replay } = buildFeedback(content, anchor, 'piano', 2)
    expect(replay.events).toHaveLength(3)
    expect(replay.events[1].atSec).toBeCloseTo(2, 12)
    expect(replay.events[2].atSec).toBeCloseTo(2.5, 12)
  })

  it('slow：只含内容，时刻与时值都除以 SLOW_FACTOR', () => {
    const { slow } = buildFeedback(content, anchor, 'piano')
    expect(slow.events).toHaveLength(2)
    expect(slow.events[1].atSec).toBeCloseTo(0.5 / SLOW_FACTOR, 12)
    expect(slow.events[1].durSec).toBeCloseTo(0.5 / SLOW_FACTOR, 12)
    expect(slow.totalDurSec).toBeCloseTo(1 / SLOW_FACTOR, 12)
  })

  it('无锚点时内容不后移', () => {
    const { replay } = buildFeedback(content, [], 'piano')
    expect(replay.events[0].atSec).toBe(0)
  })

  it('越界音高被折叠回 36–96', () => {
    const { replay, slow } = buildFeedback([{ midi: 20, atSec: 0, durSec: 1 }], [], 'piano')
    expect(freqToMidi(replay.events[0].freqHz)).toBeGreaterThanOrEqual(36 - 1e-6)
    expect(freqToMidi(slow.events[0].freqHz)).toBeGreaterThanOrEqual(36 - 1e-6)
  })

  it('使用指定音色', () => {
    const { replay } = buildFeedback(content, anchor, 'strings')
    expect(replay.events.every((e) => e.timbreId === 'strings')).toBe(true)
  })
})
