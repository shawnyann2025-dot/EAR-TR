import { describe, expect, it } from 'vitest'
import { createFrameSlicer } from './frameSlicer'

/** 0,1,2,… 的样本，便于核对帧内容 */
const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i)

describe('createFrameSlicer', () => {
  it('满 2048 样本出第一帧，之后每 512 样本一帧；内容与起点正确', () => {
    const s = createFrameSlicer(2048, 512)
    const out = []
    for (let b = 0; b < 32; b++) out.push(...s.push(ramp(b * 128, 128))) // 4096 样本
    expect(out.map((f) => f.startSample)).toEqual([0, 512, 1024, 1536, 2048])
    expect(out[1].frame[0]).toBe(512)
    expect(out[1].frame[2047]).toBe(2559)
  })

  it('输出的是拷贝：之后继续推样本不改已输出的帧', () => {
    const s = createFrameSlicer(4, 2)
    const first = s.push(ramp(0, 4))
    s.push(ramp(4, 2))
    expect(Array.from(first[0].frame)).toEqual([0, 1, 2, 3])
  })

  it('块大小与 hop 不整除也正确', () => {
    const s = createFrameSlicer(8, 3)
    const out = []
    for (let b = 0; b < 10; b++) out.push(...s.push(ramp(b * 5, 5))) // 50 样本
    expect(out.map((f) => f.startSample)).toEqual(out.map((_, i) => i * 3))
    for (const f of out) expect(f.frame[0]).toBe(f.startSample)
  })
})
