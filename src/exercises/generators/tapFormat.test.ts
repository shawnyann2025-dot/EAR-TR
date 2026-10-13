import { describe, expect, it } from 'vitest'
import type { Modality } from '../../curriculum/knowledgePoints'
import type { Generator } from '../types'
import { METER_GENERATORS, MIXED_METER_GENERATORS } from './meter'
import { PATTERN_GENERATORS } from './pattern'
import { ANACRUSIS_GENERATORS, BEAT_ONE_GENERATORS } from './pickup'
import { generatorInput } from './testInput'

const CASES: [string, string, Record<Modality, Generator>][] = [
  ['pattern tap', 'rhythm:synco-8', PATTERN_GENERATORS],
  ['meter tap', 'rhythm:meter-3-4', METER_GENERATORS],
  ['mixed tap', 'rhythm:mixed-meter', MIXED_METER_GENERATORS],
  ['beat-one tap', 'rhythm:beat-one', BEAT_ONE_GENERATORS],
  ['anacrusis tap', 'rhythm:anacrusis', ANACRUSIS_GENERATORS],
]

describe('打拍生成器：maxShiftSec 与 windowSec（final review 1、5）', () => {
  for (const [name, kp, gens] of CASES) {
    it(`${name}：maxShiftSec = 半个感知拍；windowSec = 内容时长，目标起音都在窗内`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        for (const step of [0, 3, 5]) {
          const input = generatorInput(kp, 'sing', { seed, step })
          const r = gens.sing(input)
          if (r.format.kind !== 'tap' || r.answer.kind !== 'tap') throw new Error('格式错')
          expect(r.format.maxShiftSec).toBeCloseTo(30 / input.resolved.bpm, 12)
          expect(r.format.windowSec).toBeCloseTo(r.durSec, 12)
          for (const t of r.answer.onsetsSec) expect(t).toBeLessThan(r.format.windowSec)
        }
      }
    })
  }
})
