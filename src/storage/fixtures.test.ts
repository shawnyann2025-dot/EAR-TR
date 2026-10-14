import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import type { PhaseId } from '../curriculum/stages'
import { createRuntime } from '../runtime/runtime'
import { bossReadyBundle } from './fixtures'
import { parseBundle } from './bundle'
import { MemoryRepository } from './memory'

const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5']
const file = (p: PhaseId) => `docs/fixtures/boss-ready-${p}.json`

if (process.env.UPDATE_FIXTURES === '1') {
  describe('真机验收夹具（重写）', () => {
    it('写出 docs/fixtures/boss-ready-P1..P5.json', () => {
      mkdirSync('docs/fixtures', { recursive: true })
      for (const p of PHASES) writeFileSync(file(p), JSON.stringify(bossReadyBundle(p), null, 2) + '\n')
    })
  })
} else {
  describe.each(PHASES)('真机验收夹具 %s', (p) => {
    it('已提交文件与生成器一致，可解析', () => {
      const json = readFileSync(file(p), 'utf8')
      expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(bossReadyBundle(p))))
      expect(() => parseBundle(json)).not.toThrow()
    })

    it('导入后实战关解锁', async () => {
      const repo = new MemoryRepository()
      const rt = createRuntime({
        repo,
        curriculum: buildCurriculum(),
        audio: { currentTime: 0, play: () => ({ startSec: 0, endSec: 0 }), stopAll: () => {} },
        timer: { after: () => () => {} },
        nowIso: () => '2026-09-02T00:00:00.000Z',
        todayLocalDate: () => '2026-09-02',
        newProfileId: () => 'unused',
      })
      await rt.importBundle(readFileSync(file(p), 'utf8'))
      const s = await rt.bossStatus()
      expect(s.phaseId).toBe(p)
      expect(s.masteryReady).toBe(true)
    })
  })
}
