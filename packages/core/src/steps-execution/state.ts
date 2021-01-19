import { ErrorObject } from 'serialize-error'
import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from '../create-step'

export type State = {
  flowErrors: ErrorObject[]
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
  flowFinished: boolean
}
