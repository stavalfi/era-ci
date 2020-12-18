import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from './create-step'

export type State = {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
}

export type GetState = () => State
