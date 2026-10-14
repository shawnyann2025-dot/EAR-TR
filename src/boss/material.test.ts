import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { bossMaterial } from './material'

const c = buildCurriculum()

describe('bossMaterial（P-5 spec §3.3：素材由课程静态推导）', () => {
  it('P1：五声音级；拍号 2/4、3/4、4/4；无和弦与进行', () => {
    const m = bossMaterial(c, 'P1')
    expect(m.melodyDegrees).toEqual(['do', 're', 'mi', 'sol', 'la'])
    expect(m.meters).toEqual(['2/4', '3/4', '4/4'])
    expect(m.progressions).toEqual([])
  })
  it('P2：大调七个音级', () => {
    expect(bossMaterial(c, 'P2').melodyDegrees).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'])
  })
  it('P3：有大调进行与功能和弦', () => {
    const m = bossMaterial(c, 'P3')
    expect(m.progressions.length).toBeGreaterThan(0)
    for (const p of m.progressions) for (const id of p) expect(m.chordIds).toContain(id)
  })
  it('P5：含借用和弦与副属和弦', () => {
    const m = bossMaterial(c, 'P5')
    for (const id of ['V/V', 'bVI', 'bVII']) expect(m.chordIds).toContain(id)
  })
  it('音型只来自已解锁知识点，且都是 1 小节', () => {
    const p1 = bossMaterial(c, 'P1').patternIds
    const p5 = bossMaterial(c, 'P5').patternIds
    expect(p1.length).toBeGreaterThan(0)
    expect(p5.length).toBeGreaterThan(p1.length)
    expect(p5).not.toContain('q-q-q-e~q-q-q')
  })
  it('后一阶段的素材包含前一阶段', () => {
    const phases = ['P1', 'P2', 'P3', 'P4', 'P5'] as const
    for (let i = 1; i < phases.length; i++) {
      const a = bossMaterial(c, phases[i - 1])
      const b = bossMaterial(c, phases[i])
      for (const d of a.melodyDegrees) expect(b.melodyDegrees).toContain(d)
      for (const id of a.chordIds) expect(b.chordIds).toContain(id)
    }
  })
})
