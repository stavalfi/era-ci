import { StepStatus } from './types'

export const didPassOrSkippedAsPassed = (stepStatus: StepStatus) =>
  [StepStatus.passed, StepStatus.skippedAsPassed].includes(stepStatus)

export function calculateCombinedStatus(statuses: StepStatus[]): StepStatus {
  if (statuses.length === 0) {
    return StepStatus.skippedAsPassed
  }
  if (statuses.includes(StepStatus.failed)) {
    return StepStatus.failed
  }
  if (statuses.includes(StepStatus.skippedAsFailed)) {
    return StepStatus.skippedAsFailed
  }
  if (statuses.includes(StepStatus.skippedAsPassed)) {
    return StepStatus.skippedAsPassed
  }
  return StepStatus.passed
}
