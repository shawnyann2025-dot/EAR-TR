import { masteryKey, type MasteryKey } from '../curriculum/knowledgePoints'
import type { AttemptRecord } from '../session/types'
import type { AttemptAggregate } from './types'

/**
 * 作答归档（主 spec §10.2）：超出 cap 的最旧部分按 MasteryKey 聚合进计数后删除。
 * 聚合表永久保留。纯函数，不修改输入。
 */
export function archiveOverflow(
  attempts: readonly AttemptRecord[],
  aggregates: readonly AttemptAggregate[],
  cap: number,
): { attempts: AttemptRecord[]; aggregates: AttemptAggregate[] } {
  if (attempts.length <= cap) return { attempts: [...attempts], aggregates: [...aggregates] }
  const overflow = attempts.slice(0, attempts.length - cap)
  const byKey = new Map<MasteryKey, AttemptAggregate>(aggregates.map((a) => [a.key, { ...a }]))
  for (const a of overflow) {
    const key = masteryKey(a.kpId, a.modality)
    const agg = byKey.get(key) ?? { key, attempts: 0, correct: 0 }
    agg.attempts++
    if (a.correct) agg.correct++
    byKey.set(key, agg)
  }
  return { attempts: attempts.slice(attempts.length - cap), aggregates: [...byKey.values()] }
}
