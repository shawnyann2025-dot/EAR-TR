import type { Key } from '../music/key'
import { mergePlans, type PlaybackPlan, type TimbreId } from '../music/playback'
import { foldPlanToRange } from '../music/register'
import { buildTonalContext, type ContextLevel } from '../music/tonalContext'

/** 整份 plan 的可听区间（P-2b spec §5，FWD-4 第二层） */
export const PLAN_MIDI_MIN = 36
export const PLAN_MIDI_MAX = 96

export function shiftPlan(plan: PlaybackPlan, offsetSec: number): PlaybackPlan {
  return {
    events: plan.events.map((e) => ({ ...e, atSec: e.atSec + offsetSec })),
    totalDurSec: plan.events.length > 0 ? plan.totalDurSec + offsetSec : 0,
  }
}

export function foldToPlanRange(plan: PlaybackPlan): PlaybackPlan {
  return foldPlanToRange(plan, PLAN_MIDI_MIN, PLAN_MIDI_MAX)
}

export interface TonalWrapInput {
  key: Key
  level: ContextLevel
  timbreId: TimbreId
  doMidi: number
  /** 题目内容，时刻相对 0 */
  content: PlaybackPlan
  /** 题目内容时长——L2/L4 的持续低音要据此伸缩；唱模态内容为空时仍需给出 */
  contentDurSec: number
}

/**
 * 管线第 3 步（T/H 轨）：主 spec §6.1 的调性语境 + 题目内容，最后整份折叠。
 * R 轨的节拍器语境在 P-2b-R 计划中另行实现。
 */
export function wrapWithTonalContext(input: TonalWrapInput): {
  plan: PlaybackPlan
  contentStartSec: number
} {
  const ctx = buildTonalContext({
    key: input.key,
    level: input.level,
    timbreId: input.timbreId,
    doMidi: input.doMidi,
    itemDurSec: input.contentDurSec,
  })
  const merged = mergePlans(ctx.plan, shiftPlan(input.content, ctx.leadInSec))
  return { plan: foldToPlanRange(merged), contentStartSec: ctx.leadInSec }
}
