import { describe, expect, it, vi } from 'vitest'
import { generatorInput } from './testInput'

let notateChordCount = 3
vi.mock('../difficulty', async (orig) => {
  const mod = await orig<typeof import('../difficulty')>()
  return {
    ...mod,
    difficultyParams: (step: number) => ({ ...mod.difficultyParams(step), notateChordCount }),
  }
})

const { FUNCTIONAL_GENERATORS } = await import('./chord')
const { renderBassline } = await import('./inversion')
const { BASSLINE_PATTERNS } = await import('../data/chords')

describe('数据假设守卫', () => {
  it('功能和弦听写：长度不足 2 时报错并点名 kpId', () => {
    notateChordCount = 1
    expect(() => FUNCTIONAL_GENERATORS.notate({ ...generatorInput('chord:vi', 'notate') })).toThrow(/chord:vi/)
    notateChordCount = 3
  })

  it('功能和弦听写：干扰池少于 3 个成员时报错并点名 kpId', () => {
    const inp = generatorInput('chord:vi', 'notate')
    const keep = new Map([...inp.curriculum.knowledgePoints].filter(([id]) => id === 'chord:vi' || id === 'chord:I'))
    const small = { ...inp, curriculum: { ...inp.curriculum, knowledgePoints: keep } }
    expect(() => FUNCTIONAL_GENERATORS.notate(small)).toThrow(/chord:vi/)
  })

  it('低音线：小调直接报错', () => {
    const inp = generatorInput('chord:bassline', 'recognize', { mode: 'minor' })
    expect(() => renderBassline(BASSLINE_PATTERNS[0], inp)).toThrow(/大调/)
  })
})
