import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

export const LIMIT_GZIP_BYTES = 150 * 1024

/** index.html 里直接执行的入口脚本（相对 dist 的路径）；按需加载的 chunk、worker、worklet 不算首屏 */
export function entryScripts(indexHtml) {
  const out = []
  for (const m of indexHtml.matchAll(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g)) {
    out.push(m[1].replace(/^.*?(assets\/)/, '$1'))
  }
  return out
}

export function checkSize(distDir, limit = LIMIT_GZIP_BYTES) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  return entryScripts(html).map((file) => {
    const gzipBytes = gzipSync(readFileSync(join(distDir, file))).length
    return { file, gzipBytes, ok: gzipBytes <= limit }
  })
}
