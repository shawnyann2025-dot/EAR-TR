import type { ContextLevel } from '../music/tonalContext'
import type { Rng } from '../music/rng'
import {
  knowledgePointsOfPhase,
  requirementFor,
  unlockedKnowledgePoints,
  type Curriculum,
} from '../curriculum/curriculum'
import {
  MODALITIES,
  masteryKey,
  type KnowledgePointId,
  type Modality,
} from '../curriculum/knowledgePoints'
import type { PhaseId, VariationLevel } from '../curriculum/stages'
import {
  ITEM_SECONDS,
  SESSION_SEGMENTS,
  itemSeconds,
  type ExerciseSpec,
  type SessionSegment,
} from './exerciseSpec'
import {
  getMastery,
  isDue,
  retrievability,
  type MasteryStore,
} from './mastery'

export interface SchedulerInput {
  curriculum: Curriculum
  store: MasteryStore
  phaseId: PhaseId
  today: number
  seed: number
  minutes: number
}

/** 热身固定时长（spec §7.4）：调性内化，跟唱音阶、找主音，不计分 */
export const WARMUP_SECONDS = 120

/** 扣除热身后，其余四段的时间占比（spec §7.4） */
export const SEGMENT_RATIOS: Record<
  Exclude<SessionSegment, 'warmup'>,
  number
> = { review: 0.4, focus: 0.4, introduce: 0.1, boss: 0.1 }

/** 一次会话最多引入几个新知识点（spec §7.4） */
export const MAX_NEW_PER_SESSION = 2

/** 热身段需要多少道唱模态题才能填满 WARMUP_SECONDS 预算 */
const WARMUP_ITEM_COUNT = Math.ceil(WARMUP_SECONDS / ITEM_SECONDS.sing)

const SEED_RANGE = 2 ** 31

export function hasBeenIntroduced(
  store: MasteryStore,
  kpId: KnowledgePointId,
): boolean {
  return MODALITIES.some((m) => store.has(masteryKey(kpId, m)))
}

/**
 * stability 最低的模态——拖后腿的优先。
 *
 * 这条直接让「三模态齐平」的关卡变得可达：若焦点段总选最强的模态，
 * 听辨会一路刷满而唱永远不达标，关卡就成了死锁。
 */
export function weakestModality(
  store: MasteryStore,
  kpId: KnowledgePointId,
): Modality {
  let best: Modality = 'recognize'
  let lowest = Infinity
  for (const m of MODALITIES) {
    const s = getMastery(store, masteryKey(kpId, m)).stability
    if (s < lowest) {
      lowest = s
      best = m
    }
  }
  return best
}

/** 可提取性最低的模态——最接近遗忘的先救 */
export function staleastModality(
  store: MasteryStore,
  kpId: KnowledgePointId,
  today: number,
): Modality {
  let best: Modality = 'recognize'
  let lowest = Infinity
  for (const m of MODALITIES) {
    const r = retrievability(getMastery(store, masteryKey(kpId, m)), today)
    if (r < lowest) {
      lowest = r
      best = m
    }
  }
  return best
}

/**
 * 分配各段时间预算（秒）。热身是固定时长，不参与比例分配；
 * 无候选的段其配额并入焦点段（spec §7.4）。
 */
export function allocateBudget(
  minutes: number,
  hasCandidates: Record<SessionSegment, boolean>,
): Record<SessionSegment, number> {
  const warmup = hasCandidates.warmup ? WARMUP_SECONDS : 0
  const remaining = Math.max(0, minutes * 60 - warmup)

  const budget: Record<SessionSegment, number> = {
    warmup,
    review: 0,
    focus: 0,
    introduce: 0,
    boss: 0,
  }

  let spilled = 0
  for (const seg of ['review', 'focus', 'introduce', 'boss'] as const) {
    const share = remaining * SEGMENT_RATIOS[seg]
    if (hasCandidates[seg]) budget[seg] = share
    else spilled += share
  }
  budget.focus += spilled
  return budget
}

function specFor(
  input: SchedulerInput,
  kpId: KnowledgePointId,
  modality: Modality,
  segment: SessionSegment,
  rng: Rng,
  contextOverride?: ContextLevel,
): ExerciseSpec {
  const { curriculum, store, phaseId } = input
  const kp = curriculum.knowledgePoints.get(kpId)
  if (!kp) throw new Error(`未知知识点 ${kpId}`)
  const state = getMastery(store, masteryKey(kpId, modality))
  const cap = requirementFor(curriculum, kpId, phaseId)
  return {
    kpId,
    modality,
    track: kp.track,
    contextLevel:
      contextOverride ??
      (Math.min(state.contextLevel, cap.contextLevel) as ContextLevel),
    variationLevel: Math.min(
      state.variationLevel,
      cap.variationLevel,
    ) as VariationLevel,
    // 快机制由会话运行时推进，不落盘（spec §7.4.1），故计划里一律从 0 起
    difficultyStep: 0,
    seed: rng.int(SEED_RANGE),
    segment,
  }
}

/** 用预算把候选填满，返回实际排入的题 */
function fillToBudget(candidates: ExerciseSpec[], budgetSec: number): ExerciseSpec[] {
  const picked: ExerciseSpec[] = []
  let used = 0
  for (const spec of candidates) {
    const cost = itemSeconds(spec)
    if (used + cost > budgetSec) break
    picked.push(spec)
    used += cost
  }
  return picked
}

export function buildCandidates(
  input: SchedulerInput,
  rng: Rng,
): Record<SessionSegment, ExerciseSpec[]> {
  const { curriculum, store, phaseId, today } = input
  const unlocked = unlockedKnowledgePoints(curriculum, phaseId)
  const introduced = unlocked.filter((id) => hasBeenIntroduced(store, id))
  const phaseKps = knowledgePointsOfPhase(curriculum, phaseId)

  // 热身：该阶段第一个已解锁的 T 轨知识点，唱模态，最强语境，不计分。
  // 用同一知识点/模态/语境、不同 seed 重复出题，凑够 WARMUP_ITEM_COUNT 道，
  // 才能填满 WARMUP_SECONDS 的预算（一道唱模态题只有 20 秒，远填不满 120 秒）。
  const warmupKp =
    unlocked.find((id) => curriculum.knowledgePoints.get(id)?.track === 'T') ??
    unlocked[0]
  const warmup = warmupKp
    ? Array.from({ length: WARMUP_ITEM_COUNT }, () =>
        specFor(input, warmupKp, 'sing', 'warmup', rng, 0),
      )
    : []

  // 复习：到期的，按可提取性升序
  const reviewPairs = introduced
    .map((kpId) => {
      const modality = staleastModality(store, kpId, today)
      const state = getMastery(store, masteryKey(kpId, modality))
      return { kpId, modality, r: retrievability(state, today), due: isDue(state, today) }
    })
    .filter((x) => x.due)
    .sort((a, b) => a.r - b.r)
  const review = reviewPairs.map((x) =>
    specFor(input, x.kpId, x.modality, 'review', rng),
  )

  // 焦点：当前阶段已引入的知识点，选最弱的模态
  const focus = phaseKps
    .filter((id) => hasBeenIntroduced(store, id))
    .map((kpId) => specFor(input, kpId, weakestModality(store, kpId), 'focus', rng))

  // 引入：尚未引入、且前置全部已引入的，一次最多 MAX_NEW_PER_SESSION 个
  const introduce = unlocked
    .filter((id) => !hasBeenIntroduced(store, id))
    .filter((id) => {
      const kp = curriculum.knowledgePoints.get(id)
      return (kp?.prerequisites ?? []).every((pre) => hasBeenIntroduced(store, pre))
    })
    .slice(0, MAX_NEW_PER_SESSION)
    .map((kpId) => specFor(input, kpId, 'recognize', 'introduce', rng))

  // 实战关：只在该阶段知识点全部引入后才排
  const allIntroduced =
    phaseKps.length > 0 && phaseKps.every((id) => hasBeenIntroduced(store, id))
  const boss = allIntroduced
    ? phaseKps.map((kpId) =>
        specFor(input, kpId, weakestModality(store, kpId), 'boss', rng),
      )
    : []

  const pools: Record<SessionSegment, ExerciseSpec[]> = {
    warmup,
    review,
    focus,
    introduce,
    boss,
  }

  const hasCandidates = Object.fromEntries(
    SESSION_SEGMENTS.map((seg) => [seg, pools[seg].length > 0]),
  ) as Record<SessionSegment, boolean>

  const budget = allocateBudget(input.minutes, hasCandidates)

  return Object.fromEntries(
    SESSION_SEGMENTS.map((seg) => [seg, fillToBudget(pools[seg], budget[seg])]),
  ) as Record<SessionSegment, ExerciseSpec[]>
}
