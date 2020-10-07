import { serializeError } from 'serialize-error'
import { Artifact, Graph } from '../types'
import { calculateCombinedStatus } from '../utils'
import { checkIfCanRunStepOnArtifact } from './can-run-step'
import {
  AbortResult,
  CanRunStepOnArtifactResult,
  CreateStepOptions,
  DoneResult,
  ExecutionStatus,
  RunningResult,
  RunStepOnArtifact,
  RunStepOnArtifacts,
  RunStepOnRoot,
  RunStepOptions,
  ScheduledResult,
  Status,
  Step,
  StepResultOfArtifacts,
  UserArtifactResult,
  UserRunStepOptions,
  UserStepResult,
} from './types'
import { validateUserStepResult } from './validations'

export {
  ExecutionStatus,
  DoneResult,
  RunningResult,
  AbortResult,
  ScheduledResult,
  Status,
  Step,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  DoneStepResultOfArtifacts,
  AbortStepResultOfArtifacts,
  RunningStepResultOfArtifacts,
  ScheduledStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  AbortStepsResultOfArtifact,
  RunningStepsResultOfArtifact,
  ScheduledStepsResultOfArtifact,
} from './types'

export { stepToString, toStepsResultOfArtifactsByArtifact } from './utils'

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
          artifactName: artifact.data.artifact.packageJson.name,
          stepResult: {
            executionStatus: ExecutionStatus.done,
            status: stepResult.status,
            notes: [],
            durationMs: Date.now() - userRunStepOptions.startStepMs,
            error: stepResult.error,
          },
        })
      } catch (error: unknown) {
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name,
          stepResult: {
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
            notes: [],
            durationMs: Date.now() - userRunStepOptions.startStepMs,
            error: serializeError(error),
          },
        })
      }
    } else {
      artifactsResult.push({
        artifactName: artifact.data.artifact.packageJson.name,
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: canRunResult.artifactStepResult.status,
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
      artifactName: node.data.artifact.packageJson.name,
      stepResult: {
        executionStatus: ExecutionStatus.done,
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
              executionStatus: ExecutionStatus.aborted,
              status: canRun.artifactStepResult.status,
              durationMs: Date.now() - startStepMs,
              notes: canRun.artifactStepResult.notes,
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
        stepResult: {
          executionStatus: ExecutionStatus.done,
          status: Status.failed,
          durationMs: Date.now() - startStepMs,
          notes: problems,
        },
        artifactsResult: runStepOptions.artifacts.map(node => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepResult: {
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
              durationMs: Date.now() - startStepMs,
              notes: [],
            },
          },
        })),
      }
    }

    const artifactsResult: Graph<{
      artifact: Artifact
      artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
    }> = runStepOptions.artifacts.map((node, i) => {
      const result = userStepResult.artifactsResult[node.index]
      if (result.stepResult.status === Status.passed || result.stepResult.status === Status.failed) {
        return {
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepResult: {
              executionStatus: ExecutionStatus.done,
              status: result.stepResult.status,
              durationMs: result.stepResult.durationMs,
              error: result.stepResult.error,
              notes: Array.from(
                new Set([...result.stepResult.notes, ...canRunStepResultOnArtifacts[i].artifactStepResult.notes]),
              ),
            },
          },
        }
      } else {
        return {
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepResult: {
              executionStatus: ExecutionStatus.aborted,
              status: result.stepResult.status,
              durationMs: result.stepResult.durationMs,
              error: result.stepResult.error,
              notes: Array.from(
                new Set([...result.stepResult.notes, ...canRunStepResultOnArtifacts[i].artifactStepResult.notes]),
              ),
            },
          },
        }
      }
    })

    const areAllDone = artifactsResult.every(a => a.data.artifactStepResult.executionStatus === ExecutionStatus.done)

    if (areAllDone) {
      return {
        stepInfo: {
          stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
          stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
        },
        stepResult: {
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - startStepMs,
          notes: userStepResult.stepResult.notes,
          status: calculateCombinedStatus(
            userStepResult.artifactsResult.map(a => {
              if (a.stepResult.executionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here`)
              }
              return a.stepResult.status
            }),
          ),
        },
        artifactsResult: artifactsResult.map(a => {
          if (a.data.artifactStepResult.executionStatus !== ExecutionStatus.done) {
            throw new Error(`we can't be here`)
          }
          return {
            ...a,
            data: {
              artifact: a.data.artifact,
              artifactStepResult: {
                ...a.data.artifactStepResult,
                executionStatus: ExecutionStatus.done,
              },
            },
          }
        }),
      }
    } else {
      return {
        stepInfo: {
          stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
          stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
        },
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - startStepMs,
          notes: userStepResult.stepResult.notes,
          status: calculateCombinedStatus(userStepResult.artifactsResult.map(a => a.stepResult.status)),
        },
        artifactsResult: artifactsResult,
      }
    }
  } catch (error: unknown) {
    const endDurationMs = Date.now() - startStepMs
    const result: StepResultOfArtifacts = {
      stepInfo: {
        stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
        stepName: runStepOptions.currentStepInfo.data.stepInfo.stepName,
      },
      stepResult: {
        executionStatus: ExecutionStatus.done,
        durationMs: endDurationMs,
        notes: [],
        status: Status.failed,
        error: serializeError(error),
      },
      artifactsResult: runStepOptions.artifacts.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          artifactStepResult: {
            executionStatus: ExecutionStatus.done,
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

      const artifactsResult: Graph<{
        artifact: Artifact
        artifactStepResult:
          | DoneResult
          | AbortResult<Status.skippedAsPassed | Status.skippedAsFailed>
          | RunningResult
          | ScheduledResult
      }> = result.artifactsResult

      await Promise.all(
        artifactsResult.map(a =>
          a.data.artifactStepResult.executionStatus === ExecutionStatus.done ||
          a.data.artifactStepResult.executionStatus === ExecutionStatus.aborted
            ? runStepOptions.cache.step.setArtifactStepResult({
                artifactHash: a.data.artifact.packageHash,
                stepId: runStepOptions.currentStepInfo.data.stepInfo.stepId,
                artifactStepResult: a.data.artifactStepResult,
              })
            : Promise.resolve(),
        ),
      )

      return result
    },
  })
}
