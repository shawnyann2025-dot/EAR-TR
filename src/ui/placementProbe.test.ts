import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { generate } from '../exercises/generate'
import { initialPlacement } from '../scheduling/placement'
import { sessionSeed } from '../session/time'
import { PLACEMENT_DAY, probeSeed, probeSpec } from './placementProbe'

const c = buildCurriculum()

describe('probeSpec（主 spec §7.7、P-3 spec §6.1）', () => {
  it('识别模态、最低语境与难度；每个探针都能出题', () => {
    for (const kp of initialPlacement(c).probes) {
      const spec = probeSpec(c, kp, 1)
      expect(spec).toMatchObject({ kpId: kp, modality: 'recognize', contextLevel: 0, variationLevel: 0, difficultyStep: 0, segment: 'focus' })
      expect(spec.track).toBe(c.knowledgePoints.get(kp)!.track)
      expect(() => generate(spec, c)).not.toThrow()
    }
  })
  it('种子由 profile 与探针序号确定性派生，与练习日不重叠', () => {
    expect(probeSeed('p', 3)).toBe(sessionSeed('p', PLACEMENT_DAY, 3))
    expect(PLACEMENT_DAY).toBeLessThan(0)
  })
})
