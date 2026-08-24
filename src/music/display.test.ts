import { describe, expect, it } from 'vitest'
import { displayDegree, type DisplayScheme } from './display'
import { SCALE_DEGREES } from './key'

const SCHEMES: DisplayScheme[] = ['solfege', 'numeric', 'degree']

describe('displayDegree', () => {
  it('唱名皮肤直接返回音级名', () => {
    expect(displayDegree('do', 'solfege')).toBe('do')
    expect(displayDegree('sol', 'solfege')).toBe('sol')
    expect(displayDegree('te', 'solfege')).toBe('te')
  })

  it('简谱皮肤用数字，变化音带升降号', () => {
    expect(displayDegree('do', 'numeric')).toBe('1')
    expect(displayDegree('mi', 'numeric')).toBe('3')
    expect(displayDegree('ti', 'numeric')).toBe('7')
    expect(displayDegree('te', 'numeric')).toBe('♭7')
    expect(displayDegree('fi', 'numeric')).toBe('♯4')
  })

  it('级数皮肤带脱字符前缀', () => {
    expect(displayDegree('do', 'degree')).toBe('^1')
    expect(displayDegree('la', 'degree')).toBe('^6')
    expect(displayDegree('me', 'degree')).toBe('♭^3')
  })

  it('每种皮肤下 12 个音级都有非空且互不相同的显示串', () => {
    for (const scheme of SCHEMES) {
      const labels = SCALE_DEGREES.map((d) => displayDegree(d, scheme))
      labels.forEach((l) => expect(l.length).toBeGreaterThan(0))
      expect(new Set(labels).size).toBe(12)
    }
  })
})
