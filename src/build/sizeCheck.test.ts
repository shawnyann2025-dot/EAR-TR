import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 纯 JS 模块，无类型声明
import { checkSize, entryScripts, LIMIT_GZIP_BYTES } from '../../scripts/sizeCheck.mjs'

describe('包体积检查（P-6 spec §4.3）', () => {
  it('从 index.html 找入口脚本，去掉 base 前缀', () => {
    const html = '<script type="module" crossorigin src="/EAR-TR/assets/index-abc.js"></script><link rel="modulepreload" href="/x.js">'
    expect(entryScripts(html)).toEqual(['assets/index-abc.js'])
    expect(entryScripts('<script type="module" src="/assets/a.js"></script>')).toEqual(['assets/a.js'])
  })
  it('阈值 150 KB；超限与不超限', () => {
    expect(LIMIT_GZIP_BYTES).toBe(150 * 1024)
    const dir = 'node_modules/.tmp-size-test'
    mkdirSync(`${dir}/assets`, { recursive: true })
    writeFileSync(`${dir}/index.html`, '<script type="module" src="/assets/a.js"></script>')
    writeFileSync(`${dir}/assets/a.js`, 'x'.repeat(10_000))
    const [r] = checkSize(dir, 1000)
    expect(r.file).toBe('assets/a.js')
    expect(r.ok).toBe(r.gzipBytes <= 1000)
    expect(checkSize(dir, 10)[0].ok).toBe(false)
  })
})
