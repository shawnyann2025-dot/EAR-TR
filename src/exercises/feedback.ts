import { mergePlans, notesToPlan, type NoteSpec, type TimbreId } from '../music/playback'
import { foldToPlanRange } from './context'
import { SLOW_FACTOR } from './difficulty'
import type { FeedbackPlan } from './types'

/** T/H 轨锚点（主音）时长 */
export const FEEDBACK_ANCHOR_SEC = 0.6
/** 锚点与内容之间的空隙 */
export const FEEDBACK_GAP_SEC = 0.25

function endOf(notes: readonly NoteSpec[]): number {
  return notes.reduce((max, n) => Math.max(max, n.atSec + n.durSec), 0)
}

/**
 * 管线第 4 步（主 spec §6.4）。
 *
 * replay：锚点（T/H 为主音，R 为一小节节拍器）→ 题目内容，「趁错误还在耳朵里时做对比」。
 * slow：同一内容放慢，不含语境与锚点。
 * 「你选的 vs 正确的」标在音阶条上是显示层的事，不在这里产出。
 */
export function buildFeedback(
  contentNotes: readonly NoteSpec[],
  anchorNotes: readonly NoteSpec[],
  timbreId: TimbreId,
  /** 内容相对锚点起点的位移；给定时取代「锚点结束 + 间隔」（R 轨要对准脉冲网格） */
  contentOffsetSec?: number,
  /** 锚点音色；默认同内容（R 轨点击用固定音色） */
  anchorTimbreId: TimbreId = timbreId,
): FeedbackPlan {
  const offset =
    contentOffsetSec ?? (anchorNotes.length > 0 ? endOf(anchorNotes) + FEEDBACK_GAP_SEC : 0)
  const replay = mergePlans(
    notesToPlan([...anchorNotes], anchorTimbreId),
    notesToPlan(contentNotes.map((n) => ({ ...n, atSec: n.atSec + offset })), timbreId),
  )
  const slow = notesToPlan(
    contentNotes.map((n) => ({
      ...n,
      atSec: n.atSec / SLOW_FACTOR,
      durSec: n.durSec / SLOW_FACTOR,
    })),
    timbreId,
  )
  return { replay: foldToPlanRange(replay), slow: foldToPlanRange(slow) }
}
