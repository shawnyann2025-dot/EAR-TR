import { describe, expect, it } from 'vitest'
import { ALL_KNOWLEDGE_POINTS, knowledgePointsOfTrack } from './tracks'
import { parseKpId, trackOfKind } from './knowledgePoints'

describe('ALL_KNOWLEDGE_POINTS', () => {
  it('id 互不重复', () => {
    const ids = ALL_KNOWLEDGE_POINTS.map((kp) => kp.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个知识点的 track 与其 kind 推出的轨道一致', () => {
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      expect(kp.track).toBe(trackOfKind(parseKpId(kp.id).kind))
      expect(kp.track).toBe(trackOfKind(kp.kind))
    }
  })

  it('每个知识点都有非空中文标签', () => {
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      expect(kp.label.length).toBeGreaterThan(0)
    }
  })

  it('前置知识点全部存在于本表内，且不自引用', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    for (const kp of ALL_KNOWLEDGE_POINTS) {
      for (const pre of kp.prerequisites) {
        expect(ids.has(pre)).toBe(true)
        expect(pre).not.toBe(kp.id)
      }
    }
  })

  it('三条轨道都有知识点，且合起来等于全集', () => {
    const t = knowledgePointsOfTrack('T')
    const h = knowledgePointsOfTrack('H')
    const r = knowledgePointsOfTrack('R')
    expect(t.length).toBeGreaterThan(0)
    expect(h.length).toBeGreaterThan(0)
    expect(r.length).toBeGreaterThan(0)
    expect(t.length + h.length + r.length).toBe(ALL_KNOWLEDGE_POINTS.length)
  })

  it('大调七音级与小调七音级都齐全，且互为不同的知识点', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    for (const d of ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti']) {
      expect(ids.has(`degree:major:${d}`)).toBe(true)
    }
    for (const d of ['la', 'ti', 'do', 're', 'mi', 'fa', 'sol']) {
      expect(ids.has(`degree:minor:${d}`)).toBe(true)
    }
    // 决策 2：同名音级在两个调式下是两个知识点
    expect(ids.has('degree:major:mi')).toBe(true)
    expect(ids.has('degree:minor:mi')).toBe(true)
  })

  it('H 轨含三条 spec §8.1 H5 点名的流行进行', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    expect(ids.has('prog:I-V-vi-IV')).toBe(true)
    expect(ids.has('prog:vi-IV-I-V')).toBe(true)
    expect(ids.has('prog:I-vi-IV-V')).toBe(true)
  })

  it('各轨道的知识点条数固定，漏一条即失败', () => {
    expect(knowledgePointsOfTrack('T')).toHaveLength(20)
    expect(knowledgePointsOfTrack('H')).toHaveLength(26)
    expect(knowledgePointsOfTrack('R')).toHaveLength(15)
    expect(ALL_KNOWLEDGE_POINTS).toHaveLength(61)
  })

  it('R 轨全部 15 条节奏知识点都存在', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    const rhythmIds = [
      'rhythm:beat-one',
      'rhythm:meter-2-4',
      'rhythm:meter-3-4',
      'rhythm:quarter',
      'rhythm:eighth-pair',
      'rhythm:dotted',
      'rhythm:rest',
      'rhythm:sixteenth',
      'rhythm:synco-8',
      'rhythm:triplet',
      'rhythm:meter-6-8',
      'rhythm:anacrusis',
      'rhythm:tie-across-bar',
      'rhythm:mixed-meter',
      'rhythm:synco-16',
    ]
    for (const id of rhythmIds) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('T 轨变化音与转调全部存在', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    const toneIds = [
      'degree:major:fi',
      'degree:major:te',
      'degree:major:me',
      'degree:minor:si',
      'degree:minor:fi',
      'degree:modulation:shift',
    ]
    for (const id of toneIds) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('H 轨所有和弦与进行都存在', () => {
    const ids = new Set(ALL_KNOWLEDGE_POINTS.map((kp) => kp.id))
    const harmonyIds = [
      'chord:quality-maj',
      'chord:quality-min',
      'chord:I',
      'chord:IV',
      'chord:V',
      'chord:vi',
      'chord:ii',
      'chord:V7',
      'chord:Imaj7',
      'chord:ii7',
      'chord:vi7',
      'prog:I-V-vi-IV',
      'prog:vi-IV-I-V',
      'prog:I-vi-IV-V',
      'chord:inv-first',
      'chord:inv-second',
      'chord:bassline',
      'chord:i',
      'chord:iv',
      'chord:VI',
      'chord:III',
      'chord:VII',
      'prog:i-VI-III-VII',
      'chord:V-of-V',
      'chord:borrowed-bVI',
      'chord:borrowed-bVII',
    ]
    for (const id of harmonyIds) {
      expect(ids.has(id)).toBe(true)
    }
  })
})
