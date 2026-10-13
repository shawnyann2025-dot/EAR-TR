import { describe, expect, it } from 'vitest'
import type { AttemptRecord } from '../session/types'
import { parseBundle } from './bundle'
import { MemoryRepository } from './memory'

describe('导出包往返：唱题检测 detail（P-4 spec §5）', () => {
  it('detail { kind: pitch, perTarget, centsOff（含 null） } 导出 → JSON → 导入 → 再导出后保持不变', async () => {
    const attempt: AttemptRecord = {
      at: '2026-10-13T00:00:01.000Z', day: 0, sessionNo: 0, kpId: 'degree:major:do', modality: 'sing',
      spec: { kpId: 'degree:major:do', modality: 'sing', track: 'T', contextLevel: 0, variationLevel: 0, difficultyStep: 0, seed: 1, segment: 'focus' },
      correct: false, latencyMs: 1200, detail: { kind: 'pitch', perTarget: [true, false], centsOff: [3.2, null] },
    }
    const a = new MemoryRepository()
    await a.appendAttempt(attempt)
    const json = JSON.stringify(await a.exportAll('2026-10-13T00:00:00.000Z'))
    const b = new MemoryRepository()
    await b.importAll(parseBundle(json))
    const again = await b.exportAll('2026-10-13T00:00:00.000Z')
    expect(again.attempts).toHaveLength(1)
    expect(again.attempts[0].detail).toEqual({ kind: 'pitch', perTarget: [true, false], centsOff: [3.2, null] })
  })
})
