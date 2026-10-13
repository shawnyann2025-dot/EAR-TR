/**
 * difficultyStep（快机制，0 最易、5 最难）→ 题内参数（P-2b spec §6）。
 *
 * 只调单题内参数，不碰语境强度与变异轴——那是慢机制的职责（主 spec §7.4.1）。
 */
export const DIFFICULTY_TABLE = {
  /** 听辨选项个数。Infinity = 池里全部；实际个数另受池大小限制，至少 2 */
  recognizeOptionCount: [2, 3, 4, 5, 6, Infinity],
  /** 听辨目标音 / 和弦时长（秒），以 BASE_BPM 为基准，随速度缩放 */
  recognizeNoteSec: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5],
  /** T 轨听写旋律音数（主 spec §6.3：3–8 音） */
  notateMelodyLength: [3, 4, 5, 6, 7, 8],
  /** H 轨听写和弦个数 */
  notateChordCount: [2, 3, 3, 4, 4, 5],
  /** R 轨听写小节数 */
  notateRhythmBars: [1, 1, 2, 2, 2, 4],
  /** T/H 唱模态目标音个数 */
  singTargetCount: [1, 1, 2, 2, 3, 3],
  /** R 轨打拍容差（秒） */
  tapToleranceSec: [0.12, 0.11, 0.1, 0.08, 0.07, 0.06],
  /** R 轨打拍小节数 */
  tapBars: [1, 1, 1, 2, 2, 2],
} as const satisfies Record<string, readonly number[]>

export interface DifficultyParams {
  recognizeOptionCount: number
  recognizeNoteSec: number
  notateMelodyLength: number
  notateChordCount: number
  notateRhythmBars: number
  singTargetCount: number
  tapToleranceSec: number
  tapBars: number
}

export const MIN_DIFFICULTY_STEP = 0
export const MAX_DIFFICULTY_STEP = 5

/** 唱模态音高容差（音分），固定不随档位变（主 spec §9） */
export const SING_CENTS_TOLERANCE = 50

/** 慢速反馈：bpm × SLOW_FACTOR，时值 ÷ SLOW_FACTOR（P-2b spec §6） */
export const SLOW_FACTOR = 0.6

/** recognizeNoteSec 的速度基准 */
export const BASE_BPM = 90

export function clampDifficultyStep(step: number): number {
  return Math.min(MAX_DIFFICULTY_STEP, Math.max(MIN_DIFFICULTY_STEP, Math.round(step)))
}

export function difficultyParams(step: number): DifficultyParams {
  const i = clampDifficultyStep(step)
  const out = {} as DifficultyParams
  for (const name of Object.keys(DIFFICULTY_TABLE) as (keyof typeof DIFFICULTY_TABLE)[]) {
    out[name] = DIFFICULTY_TABLE[name][i]
  }
  return out
}
