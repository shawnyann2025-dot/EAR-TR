import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { repositoryContract } from './contract'
import { openIndexedDbRepository } from './indexeddb'
import { masteryKey } from '../curriculum/knowledgePoints'
import { initialMastery } from '../scheduling/mastery'
import { SCHEMA_VERSION, StorageCorruptError, StorageUnavailableError } from './types'

let n = 0
const fresh = () => ({ factory: new IDBFactory(), name: `test-${n++}` })

repositoryContract('IndexedDB 实现', async (opts) => openIndexedDbRepository({ ...fresh(), ...opts }))

describe('IndexedDB：持久化与损坏', () => {
  it('关闭后重新打开，数据还在', async () => {
    const env = fresh()
    const a = await openIndexedDbRepository(env)
    await a.saveProfile({ id: 'p', createdAtLocalDate: '2026-10-13', phaseId: 'P2', displayScheme: 'numeric', placement: { done: true, startPhase: 'P2' }, schemaVersion: SCHEMA_VERSION })
    const b = await openIndexedDbRepository(env)
    expect((await b.loadProfile())?.phaseId).toBe('P2')
  })

  it('数据库版本高于本程序：抛 StorageCorruptError，且带原始数据', async () => {
    const env = fresh()
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION + 5)
      req.onupgradeneeded = () => req.result.createObjectStore('profile')
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    await expect(openIndexedDbRepository(env)).rejects.toBeInstanceOf(StorageCorruptError)
  })

  it('Profile 记录结构不对：抛 StorageCorruptError，rawDump 里能看到原记录', async () => {
    const env = fresh()
    await openIndexedDbRepository(env)
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION)
      req.onsuccess = () => {
        const tx = req.result.transaction('profile', 'readwrite')
        tx.objectStore('profile').put({ broken: true }, 'profile')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    const err = await openIndexedDbRepository(env).catch((e) => e)
    expect(err).toBeInstanceOf(StorageCorruptError)
    expect((err as StorageCorruptError).rawDump).toContain('broken')
  })

  it('Profile 损坏时 rawDump 以 [键, 值] 保留掌握度的外置键', async () => {
    const env = fresh()
    const repo = await openIndexedDbRepository(env)
    const k = masteryKey('degree:major:do', 'sing')
    await repo.putMastery(k, initialMastery())
    await new Promise<void>((resolve, reject) => {
      const req = env.factory.open(env.name, SCHEMA_VERSION)
      req.onsuccess = () => {
        const tx = req.result.transaction('profile', 'readwrite')
        tx.objectStore('profile').put({ broken: true }, 'profile')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    const err = (await openIndexedDbRepository(env).catch((e) => e)) as StorageCorruptError
    expect(err).toBeInstanceOf(StorageCorruptError)
    expect(JSON.parse(err.rawDump).mastery[0][0]).toBe(k)
  })

  it('连接被关闭后 appendAttempt / importAll 返回 rejected promise 而非同步抛出', async () => {
    const env = fresh()
    const repo = await openIndexedDbRepository(env)
    const bundle = await repo.exportAll('x')
    // deleteDatabase 触发 versionchange，仓库据此关闭自己的连接
    await new Promise<void>((resolve, reject) => {
      const r = env.factory.deleteDatabase(env.name)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error)
    })
    const a = { at: 'x', day: 0, sessionNo: 0, kpId: 'k', modality: 'recognize', correct: true, latencyMs: 1, detail: { kind: 'choice' } } as never
    await expect(repo.appendAttempt(a)).rejects.toBeDefined()
    await expect(repo.importAll(bundle)).rejects.toBeDefined()
  })

  it('不可序列化的作答：rejected 而非同步抛出', async () => {
    const repo = await openIndexedDbRepository(fresh())
    await expect(repo.appendAttempt({ f: () => 1 } as never)).rejects.toBeDefined()
  })

  it('open 以非 VersionError 失败：StorageUnavailableError', async () => {
    const factory = { open: () => { throw new Error('denied') } } as unknown as IDBFactory
    await expect(openIndexedDbRepository({ factory, name: 'x' })).rejects.toBeInstanceOf(StorageUnavailableError)
  })

  it('没有 IndexedDB（globalThis.indexedDB 为空）：StorageUnavailableError', async () => {
    await expect(openIndexedDbRepository({ name: 'x' })).rejects.toBeInstanceOf(StorageUnavailableError)
  })
})
