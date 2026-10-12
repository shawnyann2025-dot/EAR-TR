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
  type Track,
} from '../curriculum/knowledgePoints'
import type { GateSpec, PhaseId, VariationLevel } from '../curriculum/stages'
import {
  ITEM_SECONDS,
  SESSION_SEGMENTS,
  itemSeconds,
  type ExerciseSpec,
  type SessionSegment,
} from './exerciseSpec'
import { meanLadderStep } from './gating'
import {
  getMastery,
  isDue,
  retrievability,
  type MasteryState,
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
 * 距关卡的就绪度：两条关卡判据（stability、窗口平均档位）各自与阈值之比，
 * 取较小者——卡得最紧的那条决定这个 key 离过关有多远。
 *
 * 为什么不能只看 stability（裁定 H）：关卡同时要求平均档位，而档位只能
 * 靠曝光爬。一个模态若早期几次间隔答对把 stability 推到 20+，它既不再
 * 到期（不进复习段）、又不是 stability 最低的（不进焦点段）——此后几乎
 * 零曝光，阶梯永远停在 0–1 档，关卡的档位判据对它结构性不可达。
 * 180 天仿真实测：P2 的阻塞 key 里 stability 18–32、平均档位 1.0–1.65、
 * 一辈子只做过 8–16 题的正是这类「被饿死」的模态。
 */
export function gateReadiness(state: MasteryState, gate: GateSpec): number {
  return Math.min(
    state.stability / gate.stabilityThreshold,
    meanLadderStep(state.window) / gate.meanStepThreshold,
  )
}

/**
 * 三个模态按「离关卡最远者优先」排序：就绪度升序，平局按 stability 升序，
 * 再平局按 MODALITIES 顺序（全新知识点因此先出听辨——必须先认得出，
 * 才谈得上唱得出）。
 */
export function rankModalities(
  store: MasteryStore,
  kpId: KnowledgePointId,
  gate: GateSpec,
): Modality[] {
  return [...MODALITIES].sort((a, b) => {
    const sa = getMastery(store, masteryKey(kpId, a))
    const sb = getMastery(store, masteryKey(kpId, b))
    return (
      gateReadiness(sa, gate) - gateReadiness(sb, gate) ||
      sa.stability - sb.stability
    )
  })
}

/**
 * 拖后腿的模态——离关卡最远的那个优先。
 *
 * 这条直接让「三模态齐平」的关卡变得可达：若焦点段总选最强的模态，
 * 听辨会一路刷满而唱永远不达标，关卡就成了死锁。
 */
export function weakestModality(
  store: MasteryStore,
  kpId: KnowledgePointId,
  gate: GateSpec,
): Modality {
  return rankModalities(store, kpId, gate)[0]
}

/**
 * 同一天 focus/boss 段的模态分散（后备授权，spec §7.4 交错规则的落地）。
 *
 * weakestModality 本身「选最弱模态」的语义不变——它是让「三模态齐平」
 * 关卡可达的机制，不能动。但当天若多个知识点各自独立算出的最弱模态
 * 恰好都落在同一个模态上（例如某个模态阶段性普遍偏弱），focus/boss
 * 两段会把几乎全部计分题都堆进那一个模态，候选池在交错规则层面直接
 * 无解（用回溯搜索证实过：某天 23/26 题挤进同一模态，超出
 * MAX_SAME_MODALITY_RUN 的数学上限，不是交错算法的问题）。
 *
 * 这里按公平配额轮询：每个知识点仍按 rankModalities 取自己的模态优先级
 * （与 weakestModality 同一套排序、同一套平局规则），但若某个模态当天
 * 已经分到了「公平份额」（知识点数 / 3 向上取整），后面的知识点改选
 * 自己排位第二的模态，直到它也满额，以此类推。focus 与 boss 复用同一份
 * 结果（同一 kp 两段选同一模态），保持「当天集中练同一模态两次帮阶梯
 * 升档」这条设计意图不变。
 */
export function diversifiedFocusModalities(
  store: MasteryStore,
  kpIds: readonly KnowledgePointId[],
  gate: GateSpec,
): Map<KnowledgePointId, Modality> {
  const cap = Math.max(1, Math.ceil(kpIds.length / MODALITIES.length))
  const usage: Record<Modality, number> = { recognize: 0, sing: 0, notate: 0 }
  const result = new Map<KnowledgePointId, Modality>()
  for (const kpId of kpIds) {
    const ranked = rankModalities(store, kpId, gate)
    const chosen = ranked.find((m) => usage[m] < cap) ?? ranked[0]
    usage[chosen]++
    result.set(kpId, chosen)
  }
  return result
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

/**
 * 从符合条件的候选里按轨道轮询选出至多 MAX_NEW_PER_SESSION 个，
 * 保证同一天引入的新知识点尽量跨轨道，而不是把某一轨道的知识点用完
 * 才轮到下一轨道。分组内部保持传入顺序（课程手册里的级/知识点顺序）。
 */
function introduceRoundRobin(
  curriculum: Curriculum,
  eligible: KnowledgePointId[],
  today: number,
): KnowledgePointId[] {
  const byTrack = new Map<Track, KnowledgePointId[]>()
  for (const id of eligible) {
    const kp = curriculum.knowledgePoints.get(id)
    if (!kp) continue
    const bucket = byTrack.get(kp.track)
    if (bucket) bucket.push(id)
    else byTrack.set(kp.track, [id])
  }

  // 起始轨道按天轮转：否则桶的顺序永远跟着课程手册（T→H→R），
  // MAX_NEW_PER_SESSION=2 时 R 轨每个阶段都只能排在最后
  const keys = [...byTrack.keys()]
  const offset = keys.length > 0 ? ((today % keys.length) + keys.length) % keys.length : 0
  const tracks = [...keys.slice(offset), ...keys.slice(0, offset)]
  const picked: KnowledgePointId[] = []
  for (let round = 0; picked.length < MAX_NEW_PER_SESSION; round++) {
    let addedThisRound = false
    for (const t of tracks) {
      if (picked.length >= MAX_NEW_PER_SESSION) break
      const bucket = byTrack.get(t)
      if (bucket && round < bucket.length) {
        picked.push(bucket[round])
        addedThisRound = true
      }
    }
    if (!addedThisRound) break
  }
  return picked
}

export function buildCandidates(
  input: SchedulerInput,
  rng: Rng,
): Record<SessionSegment, ExerciseSpec[]> {
  const { curriculum, store, phaseId, today } = input
  const gate = curriculum.phases.find((p) => p.id === phaseId)?.gate
  if (!gate) throw new Error(`未知阶段 ${phaseId}`)
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

  // 焦点：当前阶段已引入的知识点，选最弱的模态（同一天跨知识点做模态
  // 分散，避免候选池在模态维度上塌缩——见 diversifiedFocusModalities）
  const focusKps = phaseKps.filter((id) => hasBeenIntroduced(store, id))
  const focusModalities = diversifiedFocusModalities(store, focusKps, gate)
  const focus = focusKps.map((kpId) =>
    specFor(input, kpId, focusModalities.get(kpId) ?? weakestModality(store, kpId, gate), 'focus', rng),
  )

  // 引入：尚未引入、且前置全部已引入的，一次最多 MAX_NEW_PER_SESSION 个。
  // 按轨道轮询取用（而非数组顺序取前几个）——spec §7.4 不允许单日单轨，
  // 而 unlockedKnowledgePoints 是按级顺序排列的，同轨道的知识点连在一起，
  // 顺序取前 N 个会让开局连续几天只引入同一轨道。
  const eligible = unlocked
    .filter((id) => !hasBeenIntroduced(store, id))
    .filter((id) => {
      const kp = curriculum.knowledgePoints.get(id)
      return (kp?.prerequisites ?? []).every((pre) => hasBeenIntroduced(store, pre))
    })
  const introduce = introduceRoundRobin(curriculum, eligible, today).map((kpId) =>
    specFor(input, kpId, 'recognize', 'introduce', rng),
  )

  // 实战关：只在该阶段知识点全部引入后才排
  const allIntroduced =
    phaseKps.length > 0 && phaseKps.every((id) => hasBeenIntroduced(store, id))
  // boss 与 focus 复用同一份分散结果：allIntroduced 时 phaseKps 与
  // focusKps 是同一个集合，同一 kp 在两段拿到同一个模态
  const boss = allIntroduced
    ? phaseKps.map((kpId) =>
        specFor(input, kpId, focusModalities.get(kpId) ?? weakestModality(store, kpId, gate), 'boss', rng),
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
