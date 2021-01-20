import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from '../create-step'

export type State = {
  flowFinished: boolean
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
}
