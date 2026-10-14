// 仅供 fixtures.test.ts：项目未装 @types/node，这里只声明用到的那几个 API
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, opts: { recursive: boolean }): void
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
}
declare const process: { env: Record<string, string | undefined> }
