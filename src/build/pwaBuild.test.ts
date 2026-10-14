import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const has = existsSync('dist/index.html')

describe.skipIf(!has)('PWA 构建产物（P-6 spec §3）', () => {
  it('manifest：名称、相对 start_url/scope、standalone、竖屏、主题色、四个图标', () => {
    const m = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
    expect(m).toMatchObject({ name: '练耳', short_name: '练耳', lang: 'zh-CN', display: 'standalone', orientation: 'portrait', theme_color: '#2f6fde', background_color: '#fafaf7', start_url: './', scope: './' })
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(expect.arrayContaining(['pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png']))
  })
  it('sw.js 存在，预缓存包含入口、worklet、worker、图标', () => {
    const sw = readFileSync('dist/sw.js', 'utf8')
    const assets = readdirSync('dist/assets')
    for (const prefix of ['index-', 'pitchWorklet-', 'pitchWorker-', 'micPlatform-']) {
      const f = assets.find((a) => a.startsWith(prefix) && a.endsWith('.js'))
      expect(f, prefix).toBeTruthy()
      expect(sw).toContain(`assets/${f}`)
    }
    expect(sw).toContain('pwa-192x192.png')
  })
  it('index.html：manifest、apple-touch-icon、iOS meta', () => {
    const html = readFileSync('dist/index.html', 'utf8')
    expect(html).toContain('manifest.webmanifest')
    expect(html).toContain('apple-touch-icon-180x180.png')
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
    expect(html).toContain('name="apple-mobile-web-app-title" content="练耳"')
  })
})
