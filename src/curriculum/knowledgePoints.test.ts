import { describe, expect, it } from 'vitest'
import {
  MODALITIES,
  makeKpId,
  masteryKey,
  parseKpId,
  parseMasteryKey,
  trackOfKind,
  type KnowledgePointKind,
} from './knowledgePoints'

const KINDS: KnowledgePointKind[] = ['degree', 'chord', 'prog', 'rhythm']

describe('trackOfKind', () => {
  it('音级归 T 轨，和弦与进行归 H 轨，节奏归 R 轨', () => {
    expect(trackOfKind('degree')).toBe('T')
    expect(trackOfKind('chord')).toBe('H')
    expect(trackOfKind('prog')).toBe('H')
    expect(trackOfKind('rhythm')).toBe('R')
  })

  it('四种知识点类型都有归属轨道', () => {
    for (const kind of KINDS) {
      expect(['T', 'H', 'R']).toContain(trackOfKind(kind))
    }
  })
})

describe('makeKpId / parseKpId', () => {
  it('往返一致', () => {
    for (const kind of KINDS) {
      for (const name of ['major:mi', 'V7', 'I-V-vi-IV', 'synco-8']) {
        expect(parseKpId(makeKpId(kind, name))).toEqual({ kind, name })
      }
    }
  })

  it('id 形如 kind:name', () => {
    expect(makeKpId('degree', 'major:mi')).toBe('degree:major:mi')
    expect(makeKpId('prog', 'I-V-vi-IV')).toBe('prog:I-V-vi-IV')
  })

  it('name 中含冒号时仍能正确切分（只切第一个冒号）', () => {
    // degree:major:mi 的 name 是 major:mi，不是 major
    expect(parseKpId('degree:major:mi').name).toBe('major:mi')
  })

  it('无冒号的 id 抛错', () => {
    expect(() => parseKpId('degree')).toThrow()
  })

  it('未知 kind 抛错', () => {
    expect(() => parseKpId('bogus:x')).toThrow()
  })
})

describe('masteryKey / parseMasteryKey', () => {
  it('往返一致', () => {
    for (const modality of MODALITIES) {
      const key = masteryKey('degree:major:mi', modality)
      expect(parseMasteryKey(key)).toEqual({ kpId: 'degree:major:mi', modality })
    }
  })

  it('同一知识点的三个模态产生三个互不相同的 key', () => {
    const keys = MODALITIES.map((m) => masteryKey('chord:V7', m))
    expect(new Set(keys).size).toBe(3)
  })

  it('MODALITIES 恰好是三个模态', () => {
    expect([...MODALITIES]).toEqual(['recognize', 'sing', 'notate'])
  })
})
