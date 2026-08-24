import { describe, expect, it } from 'vitest'
import { mergePlans, notesToPlan } from './playback'

describe('notesToPlan', () => {
  it('把音符转成事件，频率由 MIDI 换算', () => {
    const plan = notesToPlan([{ midi: 69, atSec: 0, durSec: 1 }], 'piano')
    expect(plan.events).toHaveLength(1)
    expect(plan.events[0].freqHz).toBeCloseTo(440, 6)
    expect(plan.events[0].timbreId).toBe('piano')
  })

  it('gain 缺省为 1', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'voice')
    expect(plan.events[0].gain).toBe(1)
  })

  it('显式 gain 被保留', () => {
    const plan = notesToPlan([{ midi: 60, atSec: 0, durSec: 1, gain: 0.3 }], 'voice')
    expect(plan.events[0].gain).toBe(0.3)
  })

  it('totalDurSec 是最后一个事件的结束时间', () => {
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 64, atSec: 2, durSec: 0.5 },
      ],
      'piano',
    )
    expect(plan.totalDurSec).toBeCloseTo(2.5, 10)
  })

  it('totalDurSec 取所有事件结束时间的最大值，与顺序无关', () => {
    const plan = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 5 },
        { midi: 64, atSec: 1, durSec: 0.5 },
      ],
      'piano',
    )
    expect(plan.totalDurSec).toBeCloseTo(5, 10)
  })

  it('空数组产出空计划', () => {
    expect(notesToPlan([], 'piano')).toEqual({ events: [], totalDurSec: 0 })
  })
})

describe('mergePlans', () => {
  it('合并事件并按 atSec 升序排列', () => {
    const a = notesToPlan([{ midi: 60, atSec: 1, durSec: 1 }], 'piano')
    const b = notesToPlan([{ midi: 67, atSec: 0, durSec: 1 }], 'strings')
    const merged = mergePlans(a, b)
    expect(merged.events.map((e) => e.atSec)).toEqual([0, 1])
    expect(merged.events[0].timbreId).toBe('strings')
  })

  it('totalDurSec 取各计划的最大值', () => {
    const a = notesToPlan([{ midi: 60, atSec: 0, durSec: 1 }], 'piano')
    const b = notesToPlan([{ midi: 67, atSec: 0, durSec: 3 }], 'strings')
    expect(mergePlans(a, b).totalDurSec).toBeCloseTo(3, 10)
  })

  it('合并保留全部事件（属性测试）', () => {
    const a = notesToPlan(
      [
        { midi: 60, atSec: 0, durSec: 1 },
        { midi: 62, atSec: 1, durSec: 1 },
      ],
      'piano',
    )
    const b = notesToPlan([{ midi: 67, atSec: 0.5, durSec: 1 }], 'voice')
    expect(mergePlans(a, b).events).toHaveLength(3)
  })

  it('无参数时返回空计划', () => {
    expect(mergePlans()).toEqual({ events: [], totalDurSec: 0 })
  })

  it('不修改输入计划', () => {
    // 用两个都非空的计划，atSec 无序，确保排序会改变某个计划的顺序
    const a = notesToPlan(
      [
        { midi: 60, atSec: 2, durSec: 1 },
        { midi: 62, atSec: 1, durSec: 1 },
      ],
      'piano',
    )
    const b = notesToPlan([{ midi: 64, atSec: 0, durSec: 1 }], 'strings')

    // 记录 a 的原始状态
    const aEventsRef = a.events
    const aFreqsBefore = a.events.map((e) => e.freqHz)
    const aSecBefore = a.events.map((e) => e.atSec)

    // 合并
    const merged = mergePlans(a, b)

    // 验证 a 的内容和顺序未改变
    expect(a.events).toBe(aEventsRef) // 数组引用未变
    expect(a.events.map((e) => e.freqHz)).toEqual(aFreqsBefore) // 内容未变
    expect(a.events.map((e) => e.atSec)).toEqual(aSecBefore) // 顺序未变（仍为 [2, 1]）

    // 验证 merged 是新数组
    expect(merged.events).not.toBe(a.events)

    // 验证 merged 已排序
    expect(merged.events.map((e) => e.atSec)).toEqual([0, 1, 2])
  })
})
