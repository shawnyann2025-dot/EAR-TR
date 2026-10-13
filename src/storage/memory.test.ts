import { repositoryContract } from './contract'
import { MemoryRepository } from './memory'

repositoryContract('内存实现', async (opts) => new MemoryRepository(opts))
