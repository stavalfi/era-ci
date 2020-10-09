import { UserRunStepOptions } from '../create-step/types'
import { CanRunStepOnArtifactsResult, CanRunStepOnArtifactsPredicate } from './types'

export function createCanRunStepOnArtifactsPredicate<
  Configurations = void,
  NormalizedConfigurations = Configurations
>(createOptions: {
  normalizeConfigurations?: (configurations: Configurations) => Promise<NormalizedConfigurations>
  predicateName: string
  predicate: (
    options: {
      configurations: NormalizedConfigurations
    } & Omit<UserRunStepOptions<never>, 'stepConfigurations'>,
  ) => Promise<true | CanRunStepOnArtifactsResult>
}) {
  return (configurations: Configurations): CanRunStepOnArtifactsPredicate => ({
    predicateName: createOptions.predicateName,
    callPredicate: async options => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedConfigurations is defined, also normalizedConfigurations is defined.
      const normalizeConfigurations: NormalizedCacheConfigurations = createOptions.normalizeConfigurations
        ? await createOptions.normalizeConfigurations(configurations)
        : configurations
      return createOptions.predicate({
        ...options,
        configurations: normalizeConfigurations,
      })
    },
  })
}
