import type { ContextLevel } from '../music/tonalContext'
import type { KnowledgePointId, Track } from './knowledgePoints'

/** 当前开放到第几个变异轴（spec §6.2）。0 = 全固定，6 = 全部六轴开放。 */
export type VariationLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 形如 T1..T8 / H1..H8 / R1..R8 */
export type StageId = string

export type PhaseId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

export const PHASE_ORDER: readonly PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']

export interface Stage {
  id: StageId
  track: Track
  label: string
  /**
   * 本级新引入的知识点。可以为空——例如 T4 不引入新音级，
   * 只把语境要求从 L1 提到 L3（建模决策 1）。
   */
  introduces: KnowledgePointId[]
  /** 本级要求达到的语境强度。数值越大语境越弱、越难（spec §6.1） */
  requiresContextLevel: ContextLevel
  requiresVariationLevel: VariationLevel
  prerequisiteStages: StageId[]
}

export interface GateSpec {
  /** 该阶段全部知识点在三个模态上都需达到的 stability（天） */
  stabilityThreshold: number
  /**
   * 窗口平均阶梯档位下限（档位范围 0–5）。
   *
   * 用平均档位而非正确率，理由同 gating（建模决策 4）：2-down-1-up 把
   * 观测正确率锁在约 71%，任何高于它的正确率门槛都会让关卡永不可过。
   */
  meanStepThreshold: number
  /** spec §8.3：无逃生口，实战关必过 */
  requiresBoss: boolean
}

export interface Phase {
  id: PhaseId
  label: string
  stages: StageId[]
  gate: GateSpec
}

const D = (name: string): KnowledgePointId => `degree:${name}`
const C = (name: string): KnowledgePointId => `chord:${name}`
const P = (name: string): KnowledgePointId => `prog:${name}`
const R = (name: string): KnowledgePointId => `rhythm:${name}`

export const ALL_STAGES: readonly Stage[] = [
  // ---- T 轨 · 音级 ----
  {
    id: 'T1', track: 'T', label: '主三和弦骨架 do mi sol',
    introduces: [D('major:do'), D('major:mi'), D('major:sol')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'T2', track: 'T', label: '五声 + re la',
    introduces: [D('major:re'), D('major:la')],
    requiresContextLevel: 1, requiresVariationLevel: 1, prerequisiteStages: ['T1'],
  },
  {
    id: 'T3', track: 'T', label: '补全大调 + fa ti',
    introduces: [D('major:fa'), D('major:ti')],
    requiresContextLevel: 1, requiresVariationLevel: 2, prerequisiteStages: ['T2'],
  },
  {
    id: 'T4', track: 'T', label: '大调全音阶随机，语境降至 L2–L3',
    introduces: [],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['T3'],
  },
  {
    id: 'T5', track: 'T', label: '自然小调（la 基）',
    introduces: [
      D('minor:la'), D('minor:do'), D('minor:mi'),
      D('minor:ti'), D('minor:re'), D('minor:fa'), D('minor:sol'),
    ],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['T4'],
  },
  {
    id: 'T6', track: 'T', label: '和声/旋律小调的升 6、升 7',
    introduces: [D('minor:si'), D('minor:fi')],
    requiresContextLevel: 3, requiresVariationLevel: 4, prerequisiteStages: ['T5'],
  },
  {
    id: 'T7', track: 'T', label: '常见变化音 fi te me',
    introduces: [D('major:fi'), D('major:te'), D('major:me')],
    requiresContextLevel: 4, requiresVariationLevel: 5, prerequisiteStages: ['T6'],
  },
  {
    id: 'T8', track: 'T', label: '转调听辨',
    introduces: [D('modulation:shift')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['T7'],
  },

  // ---- H 轨 · 和声 ----
  {
    id: 'H1', track: 'H', label: '大三 / 小三',
    introduces: [C('quality-maj'), C('quality-min')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'H2', track: 'H', label: 'I IV V 功能识别',
    introduces: [C('I'), C('IV'), C('V')],
    requiresContextLevel: 1, requiresVariationLevel: 1, prerequisiteStages: ['H1'],
  },
  {
    id: 'H3', track: 'H', label: '+ vi ii',
    introduces: [C('vi'), C('ii')],
    requiresContextLevel: 2, requiresVariationLevel: 2, prerequisiteStages: ['H2'],
  },
  {
    id: 'H4', track: 'H', label: 'V7 及常用七和弦',
    introduces: [C('V7'), C('Imaj7'), C('ii7'), C('vi7')],
    requiresContextLevel: 2, requiresVariationLevel: 3, prerequisiteStages: ['H3'],
  },
  {
    id: 'H5', track: 'H', label: '整条进行识别',
    introduces: [P('I-V-vi-IV'), P('vi-IV-I-V'), P('I-vi-IV-V')],
    requiresContextLevel: 3, requiresVariationLevel: 3, prerequisiteStages: ['H4'],
  },
  {
    id: 'H6', track: 'H', label: '转位与低音线',
    introduces: [C('inv-first'), C('inv-second'), C('bassline')],
    requiresContextLevel: 3, requiresVariationLevel: 4, prerequisiteStages: ['H5'],
  },
  {
    id: 'H7', track: 'H', label: '小调进行',
    introduces: [C('i'), C('iv'), C('III'), C('VI'), C('VII'), P('i-VI-III-VII')],
    requiresContextLevel: 3, requiresVariationLevel: 5, prerequisiteStages: ['H6'],
  },
  {
    id: 'H8', track: 'H', label: '借用和弦、副属',
    introduces: [C('V-of-V'), C('borrowed-bVI'), C('borrowed-bVII')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['H7'],
  },

  // ---- R 轨 · 节奏 ----
  {
    id: 'R1', track: 'R', label: '找 beat 1、强弱拍、拍号',
    introduces: [R('beat-one'), R('meter-2-4'), R('meter-3-4')],
    requiresContextLevel: 0, requiresVariationLevel: 0, prerequisiteStages: [],
  },
  {
    id: 'R2', track: 'R', label: '四分 + 八分基本组合',
    introduces: [R('quarter'), R('eighth-pair')],
    requiresContextLevel: 0, requiresVariationLevel: 1, prerequisiteStages: ['R1'],
  },
  {
    id: 'R3', track: 'R', label: '附点与休止',
    introduces: [R('dotted'), R('rest')],
    requiresContextLevel: 1, requiresVariationLevel: 2, prerequisiteStages: ['R2'],
  },
  {
    id: 'R4', track: 'R', label: '十六分组合',
    introduces: [R('sixteenth')],
    requiresContextLevel: 1, requiresVariationLevel: 3, prerequisiteStages: ['R3'],
  },
  {
    id: 'R5', track: 'R', label: '切分',
    introduces: [R('synco-8')],
    requiresContextLevel: 2, requiresVariationLevel: 3, prerequisiteStages: ['R4'],
  },
  {
    id: 'R6', track: 'R', label: '三连音、6/8 复合拍',
    introduces: [R('triplet'), R('meter-6-8')],
    requiresContextLevel: 2, requiresVariationLevel: 4, prerequisiteStages: ['R5'],
  },
  {
    id: 'R7', track: 'R', label: '弱起、跨小节连线',
    introduces: [R('anacrusis'), R('tie-across-bar')],
    requiresContextLevel: 3, requiresVariationLevel: 5, prerequisiteStages: ['R6'],
  },
  {
    id: 'R8', track: 'R', label: '混合拍子、复杂切分',
    introduces: [R('mixed-meter'), R('synco-16')],
    requiresContextLevel: 4, requiresVariationLevel: 6, prerequisiteStages: ['R7'],
  },
]

/**
 * 关卡阈值随阶段递增：越往后要求记忆越牢固。
 * spec §8.3：三模态齐平 + 实战关一次通过，无逃生口。
 */
export const ALL_PHASES: readonly Phase[] = [
  {
    id: 'P1', label: '找到调中心',
    stages: ['T1', 'T2', 'H1', 'H2', 'R1', 'R2'],
    gate: { stabilityThreshold: 6, meanStepThreshold: 1.5, requiresBoss: true },
  },
  {
    id: 'P2', label: '大调站稳',
    stages: ['T3', 'T4', 'H3', 'R3', 'R4'],
    gate: { stabilityThreshold: 9, meanStepThreshold: 1.8, requiresBoss: true },
  },
  {
    id: 'P3', label: '和声感',
    stages: ['T5', 'H4', 'H5', 'R5'],
    gate: { stabilityThreshold: 12, meanStepThreshold: 2, requiresBoss: true },
  },
  {
    id: 'P4', label: '实战扒谱',
    stages: ['T6', 'T7', 'H6', 'H7', 'R6', 'R7'],
    gate: { stabilityThreshold: 16, meanStepThreshold: 2.2, requiresBoss: true },
  },
  {
    id: 'P5', label: '进阶',
    stages: ['T8', 'H8', 'R8'],
    gate: { stabilityThreshold: 20, meanStepThreshold: 2.5, requiresBoss: true },
  },
]
