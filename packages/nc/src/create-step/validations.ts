import { RunStepOptions, UserStepResult } from '../types'

export function validateUserStepResult(
  runStepOptions: RunStepOptions,
  userStepResult: UserStepResult,
): {
  problems: string[]
} {
  const problems: string[] = []

  if (userStepResult.artifactsResult.length !== runStepOptions.allArtifacts.length) {
    problems.push(
      `step: "${runStepOptions.stepName}" returned result with invalid amount of packages. expected packages reuslt: "${runStepOptions.allArtifacts.length}", actual: "${userStepResult.artifactsResult.length}"`,
    )
  }
  const artifactNames = runStepOptions.allArtifacts.map(node => node.data.artifact.packageJson.name!)
  const unknownArtifactNames = userStepResult.artifactsResult.filter(
    result => !artifactNames.includes(result.artifactName),
  )

  problems.push(
    ...unknownArtifactNames.map(
      unknownArtifactName =>
        `step: "${runStepOptions.stepName}" returned result of unknown artifact: "${unknownArtifactName}"`,
    ),
  )

  return { problems }
}
