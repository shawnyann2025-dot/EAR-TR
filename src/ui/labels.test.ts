import { describe, expect, it } from 'vitest'
import { buildCurriculum } from '../curriculum/curriculum'
import { MODALITIES } from '../curriculum/knowledgePoints'
import type { VariationLevel } from '../curriculum/stages'
import { ALL_KNOWLEDGE_POINTS } from '../curriculum/tracks'
import { generate } from '../exercises/generate'
import type { ContextLevel } from '../music/tonalContext'
import { PROMPT_TEXT, chordLabel, degreeLabel, labelFor, patternLabel, showsSingTargets } from './labels'

describe('degreeLabel 与 §15.1', () => {
  it('大调按皮肤显示', () => {
    expect(degreeLabel('mi', 'solfege', 'major')).toBe('mi')
    expect(degreeLabel('mi', 'numeric', 'major')).toBe('3')
    expect(degreeLabel('fi', 'degree', 'major')).toBe('♯^4')
  })
  it('小调里的 le 显示为 si（升 7 级）', () => {
    expect(degreeLabel('le', 'solfege', 'minor')).toBe('si')
    expect(degreeLabel('le', 'numeric', 'minor')).toBe('♯5')
    expect(degreeLabel('le', 'degree', 'minor')).toBe('♯^5')
    expect(degreeLabel('le', 'solfege', 'major')).toBe('le')
  })
  it('未知音级抛错', () => {
    expect(() => degreeLabel('xx', 'solfege', 'major')).toThrow()
  })
})

describe('和弦、进行、音型', () => {
  it('和弦 id 的 b 前缀渲染为 ♭', () => {
    expect(chordLabel('bVII')).toBe('♭VII')
    expect(chordLabel('V/V')).toBe('V/V')
    expect(() => chordLabel('IX')).toThrow()
  })
  it('进行按 - 拆开渲染，不查整串', () => {
    expect(labelFor('V-vi-IV-I', { scheme: 'solfege', mode: 'major', prompt: 'which-progression' })).toBe('V → vi → IV → I')
  })
  it('音型：小节线、连线、弱起', () => {
    expect(patternLabel('q-ee-q-q')).toBe('♩ ♫ ♩ ♩')
    expect(patternLabel('q-q-q-e|q-q-q-q')).toBe('♩ ♩ ♩ ♪ | ♩ ♩ ♩ ♩')
    expect(patternLabel('q-q-q-e~q-q-q')).toBe('♩ ♩ ♩ ♪‿♩ ♩ ♩')
    expect(patternLabel('half')).toBe('弱起半拍')
  })
  it('低音线按音级渲染', () => {
    expect(labelFor('do-ti-la-fa', { scheme: 'numeric', mode: 'major', prompt: 'which-bass-contour' })).toBe('1 – 7 – 6 – 4')
  })
})

describe('题干', () => {
  it('每个题型都有中性题干，且不含知识点 id', () => {
    for (const [prompt, text] of Object.entries(PROMPT_TEXT)) {
      expect(text.length, prompt).toBeGreaterThan(0)
      expect(text, prompt).not.toMatch(/degree:|chord:|prog:|rhythm:/)
    }
  })
  it('sing-new-tonic 不显示要唱的音级，其余唱模态显示', () => {
    expect(showsSingTargets('sing-new-tonic')).toBe(false)
    expect(showsSingTargets('sing-degrees')).toBe(true)
  })
})

describe('覆盖：生成器可能产出的全部答案 id 都有文案（P-3 spec §6.4）', () => {
  it('全部知识点 × 模态 × 语境 × 变异 × 档位 × 种子', () => {
    const c = buildCurriculum()
    let checked = 0
    for (const kp of ALL_KNOWLEDGE_POINTS)
      for (const modality of MODALITIES)
        for (let v = 0; v <= 6; v++)
          for (let cl = 0; cl <= 4; cl++)
            for (let step = 0; step <= 5; step++)
              for (let seed = 0; seed < 3; seed++) {
                let ex
                try {
                  ex = generate(
                    { kpId: kp.id, modality, track: kp.track, contextLevel: cl as ContextLevel, variationLevel: v as VariationLevel, difficultyStep: step, seed, segment: 'focus' },
                    c,
                  )
                } catch {
                  continue // 该组合不在课程范围内
                }
                const ctx = { scheme: 'solfege' as const, mode: ex.resolved.key.mode, prompt: ex.prompt }
                const f = ex.format
                const ids =
                  f.kind === 'choice' ? f.options.map((o) => o.id)
                  : f.kind === 'sequence' ? f.alphabet.map((o) => o.id)
                  : f.kind === 'tap' ? (f.patternIds ?? [])
                  : []
                for (const id of ids) {
                  for (const scheme of ['solfege', 'numeric', 'degree'] as const) {
                    expect(labelFor(id, { ...ctx, scheme }).length).toBeGreaterThan(0)
                  }
                  checked++
                }
                if (f.kind === 'pitch') for (const t of f.targets) expect(degreeLabel(t.degree, 'solfege', ctx.mode).length).toBeGreaterThan(0)
              }
    expect(checked).toBeGreaterThan(1000)
  }, 120_000)
})
