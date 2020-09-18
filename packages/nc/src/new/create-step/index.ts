import { logger } from '@tahini/log'
import { StepStatus } from '../../types'
import { calculateCombinedStatus } from '../../utils'
import { CreateStep, RunStepOptions, UserRunStepOptions, UserStepResult } from '../types'

function validateUserStepResult(
  runStepOptions: RunStepOptions,
  userStepResult: UserStepResult,
): {
  problems: string[]
} {
  const problems: string[] = []

  if (userStepResult.packagesResult.length !== runStepOptions.graph.length) {
    problems.push(
      `step: "${runStepOptions.stepName}" returned result with invalid amount of packages. expected packages reuslt: "${runStepOptions.graph.length}", actual: "${userStepResult.packagesResult.length}"`,
    )
  }
  const artifactNames = runStepOptions.graph.map(node => node.data.artifact.packageJson.name!)
  const unknownArtifactNames = userStepResult.packagesResult.filter(
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

function createStepCache(runStepOptions: RunStepOptions): UserRunStepOptions['cache'] {
  return {
    step: {
      didStepRun: ({ packageHash }: { packageHash: string }) =>
        runStepOptions.cache.step.didStepRun({
          stepId: runStepOptions.stepId,
          packageHash,
        }),
      getStepResult: ({ packageHash, ttlMs }: { packageHash: string; ttlMs: number }) =>
        runStepOptions.cache.step.getStepResult({
          stepId: runStepOptions.stepId,
          packageHash,
          ttlMs,
        }),
      setStepResult: ({
        packageHash,
        stepStatus,
        ttlMs,
      }: {
        packageHash: string
        stepStatus: StepStatus
        ttlMs: number
      }) =>
        runStepOptions.cache.step.setStepResult({
          stepId: runStepOptions.stepId,
          packageHash,
          stepStatus,
          ttlMs,
        }),
    },
    get: runStepOptions.cache.get,
    set: runStepOptions.cache.set,
    has: runStepOptions.cache.has,
    nodeCache: runStepOptions.cache.nodeCache,
    redisClient: runStepOptions.cache.redisClient,
  }
}

export const createStep: CreateStep = ({ stepName, runStep, canRunStep }) => async runStepOptions => {
  const startMs = Date.now()
  try {
    const userStepResult = await runStep({
      ...runStepOptions,
      log: logger(stepName),
      cache: createStepCache(runStepOptions),
    })
    const { problems } = validateUserStepResult(runStepOptions, userStepResult)
    const endDurationMs = Date.now() - startMs
    return {
      stepSummary: {
        stepId: runStepOptions.stepId,
        stepName,
        durationMs: endDurationMs,
        notes: [...problems, ...userStepResult.stepSummary.notes],
        status:
          problems.length > 0
            ? StepStatus.failed
            : calculateCombinedStatus(userStepResult.packagesResult.map(n => n.stepResult.status)),
      },
      packagesResult: runStepOptions.graph.map(node => {
        const result = userStepResult.packagesResult.find(n => n.artifactName === node.data.artifact.packageJson.name)
        if (result) {
          return {
            ...node,
            data: {
              ...node.data,
              stepResult: {
                ...result.stepResult,
                stepId: runStepOptions.stepId,
                stepName,
              },
            },
          }
        } else {
          return {
            ...node,
            data: {
              ...node.data,
              stepResult: {
                durationMs: endDurationMs,
                notes: ['could not determine what is the result-status of this package'],
                status: StepStatus.failed,
                stepId: runStepOptions.stepId,
                stepName,
              },
            },
          }
        }
      }),
    }
  } catch (error) {
    const endDurationMs = Date.now() - startMs
    return {
      stepSummary: {
        stepId: runStepOptions.stepId,
        stepName,
        durationMs: endDurationMs,
        notes: ['step threw an error'],
        status: StepStatus.failed,
      },
      packagesResult: runStepOptions.graph.map(node => ({
        ...node,
        data: {
          ...node.data,
          stepResult: {
            durationMs: endDurationMs,
            notes: [],
            status: StepStatus.failed,
            stepId: runStepOptions.stepId,
            stepName,
          },
        },
      })),
      error,
    }
  }
}
