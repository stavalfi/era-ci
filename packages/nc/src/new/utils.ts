import { StepStatus } from './types'

export const didPassOrSkippedAsPassed = (stepStatus: StepStatus) =>
  [StepStatus.passed, StepStatus.skippedAsPassed].includes(stepStatus)
