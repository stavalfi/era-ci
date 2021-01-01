import { KeyValueStoreConnection } from './create-key-value-store-connection'
import { Log } from './create-logger'
import { Artifact, Graph } from '@era-ci/utils'

export type MutableState = {
  get: <T>(key: string, mapper: (result: unknown) => T) => Promise<T | undefined>
  set: (options: { key: string; value: string; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  cleanup: () => Promise<unknown>
}

export async function createImmutableCache({
  repoHash,
  artifacts,
  flowId,
  keyValueStoreConnection,
  log,
}: {
  keyValueStoreConnection: KeyValueStoreConnection
  flowId: string
  repoHash: string
  log: Log
  artifacts: Graph<{ artifact: Artifact }>
}): Promise<MutableState> {
  const cleanup = () => Promise.resolve()

  return {
    get: keyValueStoreConnection.get,
    has: keyValueStoreConnection.has,
    set: options =>
      keyValueStoreConnection.set({ key: options.key, ttl: options.ttl, value: options.value, allowOverride: true }),
    cleanup,
  }
}
