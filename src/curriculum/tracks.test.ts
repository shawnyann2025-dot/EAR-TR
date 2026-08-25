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
})
