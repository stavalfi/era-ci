import { UserRunStepOptions } from '../create-step/types'
import { StepConstrainResult, StepConstrain } from './types'

export function createStepConstrain<
  Configurations = void,
  NormalizedConfigurations = Configurations,
  StepConfiguration = unknown
>(createOptions: {
  normalizeConfigurations?: (configurations: Configurations) => Promise<NormalizedConfigurations>
  constrainName: string
  constrain: (
    options: {
      constrainConfigurations: NormalizedConfigurations
    } & UserRunStepOptions<StepConfiguration>,
  ) => Promise<StepConstrainResult>
}) {
  return (configurations: Configurations): StepConstrain<StepConfiguration> => ({
    constrainName: createOptions.constrainName,
    callConstrain: async options => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedConfigurations is defined, also normalizedConfigurations is defined.
      const normalizeConfigurations: NormalizedCacheConfigurations = createOptions.normalizeConfigurations
        ? await createOptions.normalizeConfigurations(configurations)
        : configurations
      return createOptions.constrain({
        ...options.userRunStepOptions,
        constrainConfigurations: normalizeConfigurations,
      })
    },
  })
}
