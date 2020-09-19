import { Cache, CreateCache } from './types'

export { Cache, CreateCache }

export function createCache<
  CacheConfigurations = void,
  NormalizedCacheConfigurations = CacheConfigurations
>(createCacheOptions: {
  normalizeCacheConfigurations?: (cacheConfigurations: CacheConfigurations) => Promise<NormalizedCacheConfigurations>
  initializeCache: (options: { cacheConfigurations: NormalizedCacheConfigurations; flowId: string }) => Promise<Cache>
}) {
  return (cacheConfigurations: CacheConfigurations): CreateCache => ({
    callInitializeCache: async ({ flowId }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
      const normalizedCacheConfigurations: NormalizedCacheConfigurations = createCacheOptions.normalizeCacheConfigurations
        ? await createCacheOptions.normalizeCacheConfigurations(cacheConfigurations)
        : cacheConfigurations
      return createCacheOptions.initializeCache({ cacheConfigurations: normalizedCacheConfigurations, flowId })
    },
  })
}
