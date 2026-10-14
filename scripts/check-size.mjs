import { checkSize, LIMIT_GZIP_BYTES } from './sizeCheck.mjs'

const results = checkSize('dist')
for (const r of results) console.log(`${r.ok ? 'OK ' : 'TOO BIG'} ${r.file} ${(r.gzipBytes / 1024).toFixed(1)} KB gzip (limit ${LIMIT_GZIP_BYTES / 1024} KB)`)
if (results.length === 0 || results.some((r) => !r.ok)) process.exit(1)
