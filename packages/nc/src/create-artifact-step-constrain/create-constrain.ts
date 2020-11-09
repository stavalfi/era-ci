import { UserRunStepOptions } from '../create-step'
import { Artifact, Node } from '../types'
import { ArtifactInStepConstrain, ArtifactInStepConstrainResult } from './types'

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
    } & Omit<UserRunStepOptions<never, never, StepConfiguration>, 'taskQueue'> & {
        currentArtifact: Node<{ artifact: Artifact }>
      },
  ) => Promise<ArtifactInStepConstrainResult>
}) {
  return (configurations: Configurations): ArtifactInStepConstrain<StepConfiguration> => ({
    constrainName: createOptions.constrainName,
    callConstrain: async options => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedConfigurations is defined, also normalizedConfigurations is defined.
      const normalizeConfigurations: NormalizedConfigurations = createOptions.normalizeConfigurations
        ? await createOptions.normalizeConfigurations(configurations)
        : configurations
      return createOptions.constrain({
        ...options.userRunStepOptions,
        currentArtifact: options.currentArtifact,
        constrainConfigurations: normalizeConfigurations,
      })
    },
  })
}
