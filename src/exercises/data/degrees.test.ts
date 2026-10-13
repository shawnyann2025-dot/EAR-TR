import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../../curriculum/curriculum'
import { DEGREE_SEMITONES } from '../../music/key'
import { DEGREE_ENTRIES, degreeEntry, requireDegreeEntry } from './degrees'

const c = buildCurriculum()
const T_KPS = [...c.knowledgePoints.values()].filter((kp) => kp.track === 'T').map((kp) => kp.id)

describe('T 轨数据表覆盖（P-2b spec §11 第 5 条）', () => {
  it('课程里每个 T 轨知识点恰好有一行，且没有多余的行', () => {
    expect(DEGREE_ENTRIES.map((e) => e.kpId).sort()).toEqual([...T_KPS].sort())
  })

  it('kpId 不重复', () => {
    const ids = DEGREE_ENTRIES.map((e) => e.kpId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('T 轨共 20 个知识点', () => {
    expect(DEGREE_ENTRIES).toHaveLength(20)
  })
})

describe('音乐含义', () => {
  it('大调骨架与小调骨架', () => {
    expect(requireDegreeEntry('degree:major:sol')).toMatchObject({ mode: 'major', degree: 'sol', pool: 'major' })
    expect(requireDegreeEntry('degree:minor:la')).toMatchObject({ mode: 'minor', degree: 'la', pool: 'minor' })
  })

  it('小调升 7 级映射到 le（半音 8，la 基导音），显示成 si 是显示层的事', () => {
    const e = requireDegreeEntry('degree:minor:si')
    expect(e.degree).toBe('le')
    expect(DEGREE_SEMITONES[e.degree]).toBe(8)
  })

  it('小调升 6 级映射到 fi（半音 6）', () => {
    expect(requireDegreeEntry('degree:minor:fi').degree).toBe('fi')
  })

  it('大调变化音 fi / te / me 属于大调池', () => {
    for (const name of ['fi', 'te', 'me'] as const) {
      expect(requireDegreeEntry(`degree:major:${name}`)).toMatchObject({ mode: 'major', degree: name, pool: 'major' })
    }
  })

  it('转调点自成一池，按大调处理', () => {
    expect(requireDegreeEntry('degree:modulation:shift')).toMatchObject({ mode: 'major', pool: 'modulation' })
  })

  it('同一池内音级不重复（否则选项 id 会撞）', () => {
    for (const pool of ['major', 'minor'] as const) {
      const degrees = DEGREE_ENTRIES.filter((e) => e.pool === pool).map((e) => e.degree)
      expect(new Set(degrees).size).toBe(degrees.length)
    }
  })
})

describe('查找', () => {
  it('未知 kpId：degreeEntry 返回 undefined，requireDegreeEntry 抛错', () => {
    expect(degreeEntry('chord:I')).toBeUndefined()
    expect(() => requireDegreeEntry('degree:major:nope')).toThrow(/degree:major:nope/)
  })
})
