import { Artifact, Graph } from '../types'
import { calculateCombinedStatus } from '../utils'
import { checkIfCanRunStepOnArtifact } from './can-run-step'
import {
  CanRunStepOnArtifactResult,
  CreateStepOptions,
  ExecutionStatus,
  Result,
  RunStepOnArtifact,
  RunStepOnArtifacts,
  RunStepOnRoot,
  RunStepOptions,
  Status,
  Step,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  UserArtifactResult,
  UserRunStepOptions,
  UserStepResult,
} from './types'
import { validateUserStepResult } from './validations'
import { serializeError } from 'serialize-error'

export {
  Status,
  ExecutionStatus,
  Step,
  StepsResultOfArtifactsByStep,
  StepsResultOfArtifactsByArtifact,
  StepInfo,
  StepResultOfArtifacts,
  Result,
  StepsResultOfArtifact,
}
export { toStepsResultOfArtifactsByArtifact, stepToString } from './utils'

async function runStepOnEveryArtifact<StepConfigurations>({
  beforeAll,
  runStepOnArtifact,
  afterAll,
  canRunStepResultOnArtifacts,
  userRunStepOptions,
}: {
  userRunStepOptions: UserRunStepOptions<StepConfigurations>
  beforeAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
  runStepOnArtifact: RunStepOnArtifact<StepConfigurations>
  afterAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
  canRunStepResultOnArtifacts: CanRunStepOnArtifactResult[]
}): ReturnType<RunStepOnArtifacts<StepConfigurations>> {
  if (beforeAll) {
    await beforeAll(userRunStepOptions)
  }
  const artifactsResult: UserArtifactResult[] = []
  for (const [i, artifact] of userRunStepOptions.artifacts.entries()) {
    const canRunResult = canRunStepResultOnArtifacts[i]
    if (canRunResult.canRun) {
      try {
        const stepResult = await runStepOnArtifact({
          ...userRunStepOptions,
          currentArtifact: userRunStepOptions.artifacts[i],
        })
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name!,
          stepResult: {
            status: stepResult.status,
            notes: [],
            durationMs: Date.now() - userRunStepOptions.startStepMs,
            error: stepResult.error,
          },
        })
      } catch (error: unknown) {
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name!,
          stepResult: {
            status: Status.failed,
            notes: [],
            durationMs: Date.now() - userRunStepOptions.startStepMs,
            error: serializeError(error),
          },
        })
      }
    } else {
      artifactsResult.push({
        artifactName: artifact.data.artifact.packageJson.name!,
        stepResult: {
          status: canRunResult.stepStatus,
          notes: [],
          durationMs: Date.now() - userRunStepOptions.startStepMs,
        },
      })
    }
  }

  if (afterAll) {
    await afterAll(userRunStepOptions)
  }

  return {
    stepResult: {
      notes: [],
    },
    artifactsResult,
  }
}

async function runStepOnRoot<StepConfigurations>({
  runStep,
  userRunStepOptions,
}: {
  runStep: RunStepOnRoot<StepConfigurations>
  userRunStepOptions: UserRunStepOptions<StepConfigurations>
}): Promise<UserStepResult> {
  const result = await runStep(userRunStepOptions)

  return {
    stepResult: {
      notes: result.notes || [],
      error: result.error,
    },
    artifactsResult: userRunStepOptions.artifacts.map(node => ({
      artifactName: node.data.artifact.packageJson.name!,
      stepResult: {
        status: result.status,
        notes: [],
        durationMs: Date.now() - userRunStepOptions.startStepMs,
      },
    })),
  }
}

async function runStep<StepConfigurations, NormalizedStepConfigurations>({
  startStepMs,
  createStepOptions,
  runStepOptions,
  stepConfigurations,
}: {
  startStepMs: number
  createStepOptions: CreateStepOptions<StepConfigurations, NormalizedStepConfigurations>
  runStepOptions: RunStepOptions
  stepConfigurations: NormalizedStepConfigurations
}): Promise<StepResultOfArtifacts> {
  try {
    const userRunStepOptions: UserRunStepOptions<NormalizedStepConfigurations> = {
      ...runStepOptions,
      log: runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName),
      stepConfigurations,
      startStepMs,
    }
    const canRunStepResultOnArtifacts = await Promise.all(
      runStepOptions.artifacts.map(node =>
        checkIfCanRunStepOnArtifact({
          ...userRunStepOptions,
          currentArtifact: node,
          canRunStepOnArtifact: createStepOptions.canRunStepOnArtifact,
        }),
      ),
    )
    let userStepResult: UserStepResult
    if (canRunStepResultOnArtifacts.every(x => !x.canRun)) {
      userStepResult = {
        stepResult: {
          notes: [],
        },
        artifactsResult: runStepOptions.artifacts.map((node, i) => {
          const canRun = canRunStepResultOnArtifacts[i]
          if (canRun.canRun) {
            throw new Error(`we can't be here. typescript dont get it`)
          }
          return {
            artifactName: node.data.artifact.packageJson.name,
            stepResult: {
              durationMs: Date.now() - startStepMs,
              status: canRun.stepStatus,
              notes: canRun.notes,
            },
          }
        }),
      }
    } else {
      if ('runStepOnArtifacts' in createStepOptions) {
        userStepResult = await createStepOptions.runStepOnArtifacts(userRunStepOptions)
      } else if ('runStepOnArtifact' in createStepOptions) {
        userStepResult = await runStepOnEveryArtifact({
          canRunStepResultOnArtifacts,
          beforeAll: createStepOptions.beforeAll,
          runStepOnArtifact: createStepOptions.runStepOnArtifact,
          afterAll: createStepOptions.afterAll,
          userRunStepOptions,
        })
      } else {
        userStepResult = await runStepOnRoot({
          runStep: createStepOptions.runStepOnRoot,
          userRunStepOptions,
        })
      }
    }

    const { problems } = validateUserStepResult(runStepOptions, userStepResult)

    if (problems.length > 0) {
      return {
        stepInfo: {
          stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
          stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
        },
        stepExecutionStatus: ExecutionStatus.done,
        stepResult: {
          status: Status.failed,
          durationMs: Date.now() - startStepMs,
          notes: problems,
        },
        artifactsResult: runStepOptions.artifacts.map(node => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepExecutionStatus: ExecutionStatus.done,
            artifactStepResult: {
              durationMs: Date.now() - startStepMs,
              notes: [],
              status: Status.failed,
            },
          },
        })),
      }
    }

    const artifactsResult: Graph<
      | {
          artifact: Artifact
          artifactStepExecutionStatus: ExecutionStatus.done
          artifactStepResult: Result<Status.passed | Status.failed>
        }
      | ({ artifact: Artifact } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.aborted
              artifactStepResult: Result<Status.skippedAsFailed | Status.skippedAsPassed>
            }
        ))
    > = runStepOptions.artifacts.map((node, i) => {
      const result = userStepResult.artifactsResult.find(n => n.artifactName === node.data.artifact.packageJson.name)
      if (!result) {
        throw new Error(
          `we can't be here. if there is a problem with 'userStepResult', it should have been discovered in 'validateUserStepResult'`,
        )
      }

      if (result.stepResult.status === Status.passed || result.stepResult.status === Status.failed) {
        return {
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepExecutionStatus: ExecutionStatus.done,
            artifactStepResult: {
              status: result.stepResult.status,
              durationMs: result.stepResult.durationMs,
              error: result.stepResult.error,
              notes: Array.from(new Set([...result.stepResult.notes, ...canRunStepResultOnArtifacts[i].notes])),
            },
          },
        }
      } else {
        return {
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepExecutionStatus: ExecutionStatus.aborted,
            artifactStepResult: {
              status: result.stepResult.status,
              durationMs: result.stepResult.durationMs,
              error: result.stepResult.error,
              notes: Array.from(new Set([...result.stepResult.notes, ...canRunStepResultOnArtifacts[i].notes])),
            },
          },
        }
      }
    })

    const areAllDone = artifactsResult.every(a => a.data.artifactStepExecutionStatus === ExecutionStatus.done)

    const stepResultOfArtifacts: StepResultOfArtifacts = {
      stepInfo: {
        stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
        stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
      },
      ...(areAllDone
        ? {
            stepExecutionStatus: ExecutionStatus.done,
            stepResult: {
              durationMs: Date.now() - startStepMs,
              notes: userStepResult.stepResult.notes,
              status: calculateCombinedStatus(userStepResult.artifactsResult.map(a => a.stepResult.status)) as
                | Status.passed
                | Status.failed,
            },
            artifactsResult: artifactsResult as Graph<{
              artifact: Artifact
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }>,
          }
        : {
            stepExecutionStatus: ExecutionStatus.aborted,
            stepResult: {
              durationMs: Date.now() - startStepMs,
              notes: userStepResult.stepResult.notes,
              status: calculateCombinedStatus(userStepResult.artifactsResult.map(a => a.stepResult.status)),
            },
            artifactsResult,
          }),
    }
    console.log('stav3', JSON.stringify(stepResultOfArtifacts, null, 2))
    return stepResultOfArtifacts
  } catch (error: unknown) {
    const endDurationMs = Date.now() - startStepMs
    const result: StepResultOfArtifacts = {
      stepInfo: {
        stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
        stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
      },
      stepExecutionStatus: ExecutionStatus.done,
      stepResult: {
        durationMs: endDurationMs,
        notes: [],
        status: Status.failed,
        error: serializeError(error),
      },
      artifactsResult: runStepOptions.artifacts.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          artifactStepExecutionStatus: ExecutionStatus.done,
          artifactStepResult: {
            durationMs: endDurationMs,
            notes: [],
            status: Status.failed,
          },
        },
      })),
    }
    return result
  }
}

export function createStep<StepConfigurations = void, NormalizedStepConfigurations = StepConfigurations>(
  createStepOptions: CreateStepOptions<StepConfigurations, NormalizedStepConfigurations>,
) {
  return (stepConfigurations: StepConfigurations): Step => ({
    stepName: createStepOptions.stepName,
    runStep: async runStepOptions => {
      const startStepMs = Date.now()
      // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
      const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
        ? await createStepOptions.normalizeStepConfigurations(stepConfigurations)
        : stepConfigurations
      const result = await runStep({
        startStepMs,
        createStepOptions,
        runStepOptions,
        stepConfigurations: normalizedStepConfigurations,
      })
      if (
        result.stepExecutionStatus === ExecutionStatus.done ||
        result.stepExecutionStatus === ExecutionStatus.aborted
      ) {
        await runStepOptions.cache.step.setStepResult(result)
      }

      return result
    },
  })
}
