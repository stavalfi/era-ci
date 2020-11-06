export type KeyValueStoreConnection = {
  get: <T>(key: string, mapper: (result: unknown) => T) => Promise<T | undefined>
  set: (options: { key: string; value: string; allowOverride: boolean; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  cleanup: () => Promise<unknown>
}

export type CreateKeyValueStoreConnection = {
  callInitializeKeyValueStoreConnection: () => Promise<KeyValueStoreConnection>
}
