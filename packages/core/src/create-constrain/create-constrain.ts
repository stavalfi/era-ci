import { UserRunStepOptions } from '../create-step'
import { Constrain, ConstrainResultBase } from './types'

export function createConstrain<
  Configurations = void,
  NormalizedConfigurations = Configurations,
  StepConfiguration = unknown
>(createOptions: {
  normalizeConfigurations?: (configurations: Configurations) => Promise<NormalizedConfigurations>
  constrainName: string
  constrain: (
    options: {
      constrainConfigurations: NormalizedConfigurations
    } & Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>,
  ) => Promise<ConstrainResultBase>
}) {
  return (configurations: Configurations): Constrain<StepConfiguration> => ({
    constrainName: createOptions.constrainName,
    callConstrain: async options => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedConfigurations is defined, also normalizedConfigurations is defined.
      const normalizeConfigurations: NormalizedConfigurations = createOptions.normalizeConfigurations
        ? await createOptions.normalizeConfigurations(configurations)
        : configurations

      return {
        constrainOptions: normalizeConfigurations,
        invoke: async () => {
          const result = await createOptions.constrain({
            ...options.userRunStepOptions,
            constrainConfigurations: normalizeConfigurations,
          })

          return {
            ...result,
            constrainName: createOptions.constrainName,
            constrainOptions: normalizeConfigurations,
          }
        },
      }
    },
  })
}
