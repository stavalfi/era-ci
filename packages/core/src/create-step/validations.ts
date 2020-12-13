import { TaskQueueBase } from '../create-task-queue'
import { RunStepOptions, UserStepResult } from './types'

export function validateUserStepResult<
  TaskQueueConfigurations,
  TaskQueue extends TaskQueueBase<TaskQueueConfigurations>
>(
  runStepOptions: RunStepOptions<TaskQueue>,
  userStepResult: UserStepResult,
): {
  problems: Array<string>
} {
  const problems: Array<string> = []

  if (userStepResult.artifactsResult.length !== runStepOptions.artifacts.length) {
    problems.push(
      `step: "${runStepOptions.currentStepInfo.data.stepInfo.stepName}" returned result with invalid amount of packages. expected packages reuslt: "${runStepOptions.artifacts.length}", actual: "${userStepResult.artifactsResult.length}"`,
    )
  }
  const artifactNames = runStepOptions.artifacts.map(node => node.data.artifact.packageJson.name)
  const unknownArtifactNames = userStepResult.artifactsResult.filter(
    result => !artifactNames.includes(result.artifactName),
  )

  problems.push(
    ...unknownArtifactNames.map(
      unknownArtifactName =>
        `step: "${runStepOptions.currentStepInfo.data.stepInfo.stepName}" returned result of unknown artifact: "${unknownArtifactName}"`,
    ),
  )

  return { problems }
}