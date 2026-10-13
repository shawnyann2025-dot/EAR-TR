import { mergePlans, notesToPlan, type NoteSpec, type PlaybackPlan, type TimbreId } from '../music/playback'
import type { Meter } from '../music/rhythm'
import type { ContextLevel } from '../music/tonalContext'
import { foldToPlanRange, shiftPlan } from './context'
import type { MetronomeMode } from './types'

export const CLICK_SEC = 0.06
export const CLICK_GAIN_ACCENT = 0.6
export const CLICK_GAIN = 0.4
/** 中性节拍器的预备拍个数（L0 加倍）——固定值，不按拍号分组，免得泄露拍号 */
export const NEUTRAL_COUNT_IN_PULSES = 4
/** L4：节拍器只覆盖内容前 40% */
export const METRONOME_L4_COVERAGE = 0.4
/**
 * 中性 L4 的节拍个数：固定常数，不随内容长度变化，免得泄露拍数（即拍号）。
 * 少于最短的中性题（startPulse 之后的内容网格至少 4 个感知拍），所以节拍器总是撤走。
 */
export const NEUTRAL_L4_PULSES = 3
/** 中性 L2 的节拍个数：固定个数、逐拍都响——没有步长，不会与小节线对齐；与 L4 相同，二者在中性模式下等价；少于最短的中性题（4 个感知拍），所以总在撤走 */
export const NEUTRAL_L2_PULSES = 3

/** 一个感知拍含几个记谱单位：x/8 复合拍是附点四分＝3 个八分（FWD-6），其余 1 个 */
export function unitsPerPulse(meter: Meter): number {
  return meter.beatUnit === 8 ? 3 : 1
}

export function pulsesPerBar(meter: Meter): number {
  return meter.beatsPerBar / unitsPerPulse(meter)
}

export interface Pulse {
  atSec: number
  downbeat: boolean
}

/** 按小节铺感知拍；bpm 是每分钟感知拍数 */
export function pulseGrid(bars: readonly Meter[], bpm: number): Pulse[] {
  const pulseSec = 60 / bpm
  const out: Pulse[] = []
  let t = 0
  for (const bar of bars) {
    const n = pulsesPerBar(bar)
    for (let i = 0; i < n; i++) out.push({ atSec: t + i * pulseSec, downbeat: i === 0 })
    t += n * pulseSec
  }
  return out
}

function click(atSec: number, accent: boolean, clickMidi: number): NoteSpec {
  return { midi: clickMidi, atSec, durSec: CLICK_SEC, gain: accent ? CLICK_GAIN_ACCENT : CLICK_GAIN }
}

export interface MetronomeWrapInput {
  bars: readonly Meter[]
  bpm: number
  level: ContextLevel
  mode: MetronomeMode
  clickMidi: number
  timbreId: TimbreId
  /** 题目内容，时刻相对 0 */
  content: PlaybackPlan
  contentDurSec: number
  /** 内容的时刻 0 对应小节网格里的第几个感知拍（默认 0）；内容从小节中间开始时使用 */
  startPulse?: number
}

/**
 * 管线第 3 步（R 轨）：节拍器语境（P-2b spec §7.1，D7）。
 * metered 按拍号分组、强拍加重；neutral 所有点击同力度、预备拍固定个数（P-2b-R 裁定 1）。
 */
export function wrapWithMetronome(input: MetronomeWrapInput): {
  plan: PlaybackPlan
  contentStartSec: number
} {
  const { bars, bpm, level, mode, clickMidi } = input
  const pulseSec = 60 / bpm
  const metered = mode === 'metered'

  const countIn: NoteSpec[] = metered
    ? pulseGrid(Array.from({ length: level === 0 ? 2 : 1 }, () => bars[0]), bpm).map((p) =>
        click(p.atSec, p.downbeat, clickMidi),
      )
    : Array.from({ length: level === 0 ? 2 * NEUTRAL_COUNT_IN_PULSES : NEUTRAL_COUNT_IN_PULSES }, (_, i) =>
        click(i * pulseSec, false, clickMidi),
      )
  const leadInSec = countIn.length * pulseSec

  const full = pulseGrid(bars, bpm)
  const start = input.startPulse ?? 0
  if (!Number.isInteger(start) || start < 0 || start >= full.length) {
    throw new Error(`startPulse 必须是 [0, ${full.length}) 内的整数：${start}`)
  }
  if (metered && start > 0) {
    throw new Error('startPulse 只用于中性节拍器：节拍（metered）预备拍之后从小节中间开始，脉冲会磕绊')
  }
  const grid = full.slice(start).map((p) => ({ atSec: p.atSec - start * pulseSec, downbeat: p.downbeat }))
  if (!metered && grid.length <= NEUTRAL_L2_PULSES) {
    throw new Error(`中性节拍器的题目至少需要 ${NEUTRAL_L2_PULSES + 1} 个感知拍，实际 ${grid.length} 个`)
  }
  const kept = grid.filter((p, i) => {
    switch (level) {
      case 0:
      case 1:
        return true
      case 2:
        return metered ? p.downbeat : i < NEUTRAL_L2_PULSES
      case 3:
        return false
      case 4:
        return metered ? p.atSec < METRONOME_L4_COVERAGE * input.contentDurSec : i < NEUTRAL_L4_PULSES
    }
  })
  const during = kept.map((p) => click(leadInSec + p.atSec, metered && p.downbeat, clickMidi))

  const merged = mergePlans(
    notesToPlan([...countIn, ...during], input.timbreId),
    shiftPlan(input.content, leadInSec),
  )
  return { plan: foldToPlanRange(merged), contentStartSec: leadInSec }
}

/** 一小节按拍号的点击，强拍加重——R 轨反馈「先放一小节节拍器」的锚点（P-2b spec §9） */
export function metronomeBarNotes(meter: Meter, bpm: number, clickMidi: number): NoteSpec[] {
  return pulseGrid([meter], bpm).map((p) => click(p.atSec, p.downbeat, clickMidi))
}
