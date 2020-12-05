import { Artifact, Node } from '@tahini/utils'
import { UserRunStepOptions } from '../create-step'
import { ArtifactInStepConstrain, ArtifactInStepConstrainResultBase } from './types'

export function createArtifactStepConstrain<
  Configurations = void,
  NormalizedConfigurations = Configurations,
  StepConfiguration = unknown
>(createOptions: {
  normalizeConfigurations?: (configurations: Configurations) => Promise<NormalizedConfigurations>
  constrainName: string
  constrain: (
    options: {
      constrainConfigurations: NormalizedConfigurations
    } & Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'> & {
        currentArtifact: Node<{ artifact: Artifact }>
      },
  ) => Promise<ArtifactInStepConstrainResultBase>
}) {
  return (configurations: Configurations): ArtifactInStepConstrain<StepConfiguration> => ({
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
            currentArtifact: options.currentArtifact,
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
