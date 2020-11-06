import { CreateKeyValueStoreConnection, KeyValueStoreConnection } from './types'

export { KeyValueStoreConnection, CreateKeyValueStoreConnection }

export function createKeyValueStoreConnection<
  CreateKeyValueStoreConnectionConfigurations = void,
  NormalizedKeyValueStoreConnectionConfigurations = CreateKeyValueStoreConnectionConfigurations
>(createKeyValueStoreConnectionOptions: {
  normalizedKeyValueStoreConnectionConfigurations?: (
    createKeyValueStoreConnectionConfigurations: CreateKeyValueStoreConnectionConfigurations,
  ) => Promise<NormalizedKeyValueStoreConnectionConfigurations>
  initializeCreateKeyValueStoreConnection: (options: {
    keyValueStoreConnectionConfigurations: NormalizedKeyValueStoreConnectionConfigurations
  }) => Promise<KeyValueStoreConnection>
}) {
  return (
    createKeyValueStoreConnectionConfigurations: CreateKeyValueStoreConnectionConfigurations,
  ): CreateKeyValueStoreConnection => ({
    callInitializeKeyValueStoreConnection: async () => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedKeyValueStoreConnectionConfigurations is defined, also normalizedKeyValueStoreConnectionConfigurations is defined.
      const normalizedKeyValueStoreConnectionConfigurations: NormalizedKeyValueStoreConnectionConfigurations = createKeyValueStoreConnectionOptions.normalizedKeyValueStoreConnectionConfigurations
        ? await createKeyValueStoreConnectionOptions.normalizedKeyValueStoreConnectionConfigurations(
            createKeyValueStoreConnectionConfigurations,
          )
        : createKeyValueStoreConnectionConfigurations

      return createKeyValueStoreConnectionOptions.initializeCreateKeyValueStoreConnection({
        keyValueStoreConnectionConfigurations: normalizedKeyValueStoreConnectionConfigurations,
      })
    },
  })
}
