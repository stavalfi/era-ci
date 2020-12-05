import _ from 'lodash'
import { serializeError } from 'serialize-error'
import {
  CombinedArtifactInStepConstrainResult,
  runCanRunStepOnArtifactPredicates,
} from '../create-artifact-step-constrain'
import { runConstrains } from '../create-step-constrain'
import { TaskQueueBase } from '../create-task-queue'
import {
  AbortResult,
  Artifact,
  ConstrainResult,
  DoneResult,
  ExecutionStatus,
  Graph,
  RunningResult,
  ScheduledResult,
  Status,
  calculateCombinedStatus,
} from '@tahini/utils'
import {
  CreateStepOptions,
  RunStepOnArtifact,
  RunStepOnArtifacts,
  RunStepOnRoot,
  RunStepOptions,
  RunStrategy,
  Step,
  StepResultOfArtifacts,
  UserArtifactResult,
  UserRunStepOptions,
  UserStepResult,
} from './types'
import { validateUserStepResult } from './validations'

export {
  AbortStepResultOfArtifacts,
  AbortStepsResultOfArtifact,
  DoneStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  RunningStepResultOfArtifacts,
  RunningStepsResultOfArtifact,
  RunStrategy,
  ScheduledStepResultOfArtifacts,
  ScheduledStepsResultOfArtifact,
  Step,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  UserRunStepOptions,
  UserStepResult,
} from './types'
export { stepToString, toStepsResultOfArtifactsByArtifact } from './utils'

async function runStepOnEveryArtifact<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
  beforeAll,
  runStepOnArtifact,
  afterAll,
  canRunStepResultOnArtifacts,
  userRunStepOptions,
}: {
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
  beforeAll?: (options: UserRunStepOptions<TaskQueue, StepConfigurations>) => Promise<void>
  runStepOnArtifact: RunStepOnArtifact<TaskQueue, StepConfigurations>
  afterAll?: (options: UserRunStepOptions<TaskQueue, StepConfigurations>) => Promise<void>
  canRunStepResultOnArtifacts: CombinedArtifactInStepConstrainResult[]
}): ReturnType<RunStepOnArtifacts<TaskQueue, StepConfigurations>> {
  if (beforeAll) {
    await beforeAll(userRunStepOptions)
  }
  const artifactsResult: UserArtifactResult[] = []
  for (const [i, artifact] of userRunStepOptions.artifacts.entries()) {
    const canRunResult = canRunStepResultOnArtifacts[i]
    if (canRunResult.constrainResult === ConstrainResult.shouldRun) {
      try {
        const stepResult = await runStepOnArtifact({
          ...userRunStepOptions,
          currentArtifact: userRunStepOptions.artifacts[i],
        })
        // can't do it shorter because typescript complains
        switch (stepResult.executionStatus) {
          case ExecutionStatus.aborted:
            artifactsResult.push({
              artifactName: artifact.data.artifact.packageJson.name,
              artifactStepResult: {
                executionStatus: ExecutionStatus.aborted,
                status: stepResult.status,
                notes: stepResult.notes,
                durationMs: Date.now() - userRunStepOptions.startStepMs,
                errors: stepResult.errors,
              },
            })
            break
          case ExecutionStatus.done:
            artifactsResult.push({
              artifactName: artifact.data.artifact.packageJson.name,
              artifactStepResult: {
                executionStatus: ExecutionStatus.done,
                status: stepResult.status,
                notes: stepResult.notes,
                durationMs: Date.now() - userRunStepOptions.startStepMs,
                errors: stepResult.errors,
              },
            })
            break
        }
      } catch (error: unknown) {
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name,
          artifactStepResult: {
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
            notes: [],
            durationMs: Date.now() - userRunStepOptions.startStepMs,
            errors: [serializeError(error)],
          },
        })
      }
    } else {
      artifactsResult.push({
        artifactName: artifact.data.artifact.packageJson.name,
        artifactStepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: canRunResult.artifactStepResult.status,
          notes: canRunResult.artifactStepResult.notes,
          errors: canRunResult.artifactStepResult.errors,
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
      errors: [],
      notes: [],
    },
    artifactsResult,
  }
}

async function runStepOnRoot<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
  runStep,
  userRunStepOptions,
}: {
  runStep: RunStepOnRoot<TaskQueue, StepConfigurations>
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
}): Promise<UserStepResult> {
  const result = await runStep(userRunStepOptions)

  return {
    stepResult: {
      notes: result.notes,
      errors: result.errors,
    },
    artifactsResult: userRunStepOptions.artifacts.map(node => {
      switch (result.executionStatus) {
        case ExecutionStatus.done:
          return {
            artifactName: node.data.artifact.packageJson.name,
            artifactStepResult: {
              errors: [],
              executionStatus: ExecutionStatus.done,
              status: result.status,
              notes: [],
              durationMs: Date.now() - userRunStepOptions.startStepMs,
            },
          }
        case ExecutionStatus.aborted:
          return {
            artifactName: node.data.artifact.packageJson.name,
            artifactStepResult: {
              errors: [],
              executionStatus: ExecutionStatus.aborted,
              status: result.status,
              notes: [],
              durationMs: Date.now() - userRunStepOptions.startStepMs,
            },
          }
      }
    }),
  }
}

async function getUserStepResult<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations,
  NormalizedStepConfigurations
>({
  startStepMs,
  createStepOptions,
  userRunStepOptions,
}: {
  startStepMs: number
  createStepOptions: CreateStepOptions<TaskQueue, StepConfigurations, NormalizedStepConfigurations>
  userRunStepOptions: UserRunStepOptions<TaskQueue, NormalizedStepConfigurations>
}): Promise<UserStepResult> {
  const [canRunPerArtifact, canRunAllArtifacts] = await Promise.all([
    Promise.all(
      userRunStepOptions.artifacts.map(node =>
        runCanRunStepOnArtifactPredicates({
          predicates: createStepOptions.constrains?.onArtifact || [],
          userRunStepOptions,
          currentArtifact: node,
        }),
      ),
    ),
    runConstrains({
      predicates: createStepOptions.constrains?.onStep || [],
      userRunStepOptions,
    }),
  ])

  const stepName = userRunStepOptions.currentStepInfo.data.stepInfo.displayName

  for (const [artifactIndex, artifactResult] of canRunPerArtifact.entries()) {
    const artifactName = userRunStepOptions.artifacts[artifactIndex].data.artifact.packageJson.name
    if (artifactResult.constrainsResult.length > 0) {
      userRunStepOptions.log.debug(
        `constains result for artifact: "${artifactName}" for step: "${stepName}" are:`,
        Object.fromEntries(
          artifactResult.constrainsResult.map((c, i) => [
            // the same constrain may appear multiple times so we need to diffrentiate between them in the keys
            `(${i})-${c.constrainName}`,
            {
              options: c.constrainOptions,
              result: c.constrainResult,
            },
          ]),
        ),
      )
    }
  }

  if (canRunAllArtifacts.constrainsResult.length > 0) {
    userRunStepOptions.log.debug(
      `constains result for step: "${stepName}" are:`,
      Object.fromEntries(
        canRunAllArtifacts.constrainsResult.map((c, i) => [
          // the same constrain may appear multiple times so we need to diffrentiate between them in the keys
          `(${i})-${c.constrainName}`,
          {
            options: c.constrainOptions || {},
            result: c.constrainResult,
          },
        ]),
      ),
    )
  }

  const shouldSkipStep =
    canRunAllArtifacts.constrainResult === ConstrainResult.shouldSkip ||
    canRunPerArtifact.every(x => x.constrainResult === ConstrainResult.shouldSkip)

  let userStepResult: UserStepResult
  if (shouldSkipStep) {
    userStepResult = {
      stepResult: {
        notes: [],
        errors: [],
      },
      artifactsResult: userRunStepOptions.artifacts.map((node, i) => {
        let status: Status.skippedAsFailed | Status.skippedAsPassed | Status.failed
        if (canRunAllArtifacts.constrainResult === ConstrainResult.shouldSkip) {
          status = canRunAllArtifacts.stepResult.status
        } else {
          const canRun = canRunPerArtifact[i]
          if (canRun.constrainResult !== ConstrainResult.shouldSkip) {
            throw new Error(`we can't be here`)
          }
          status = canRun.artifactStepResult.status
        }
        return {
          artifactName: node.data.artifact.packageJson.name,
          artifactStepResult: {
            errors: [],
            executionStatus: ExecutionStatus.aborted,
            status,
            durationMs: Date.now() - startStepMs,
            notes: [],
          },
        }
      }),
    }
  } else {
    switch (createStepOptions.run.runStrategy) {
      case RunStrategy.allArtifacts:
        userStepResult = await createStepOptions.run.runStepOnArtifacts(userRunStepOptions)
        break
      case RunStrategy.perArtifact:
        userStepResult = await runStepOnEveryArtifact({
          canRunStepResultOnArtifacts: canRunPerArtifact,
          beforeAll: createStepOptions.run.beforeAll,
          runStepOnArtifact: createStepOptions.run.runStepOnArtifact,
          afterAll: createStepOptions.run.afterAll,
          userRunStepOptions,
        })
        break
      case RunStrategy.root:
        userStepResult = await runStepOnRoot({
          runStep: createStepOptions.run.runStepOnRoot,
          userRunStepOptions,
        })
        break
    }
  }
  const copy = _.cloneDeep(userStepResult)
  copy.stepResult.notes.push(...canRunAllArtifacts.stepResult.notes)
  copy.stepResult.errors?.push(...(canRunAllArtifacts.stepResult.errors || []))
  copy.artifactsResult.forEach((a, i) => {
    a.artifactStepResult.notes.push(...canRunPerArtifact[i].artifactStepResult.notes)
    a.artifactStepResult.errors?.push(...(canRunPerArtifact[i].artifactStepResult.errors || []))
  })
  return copy
}

async function runStep<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations, NormalizedStepConfigurations>({
  startStepMs,
  createStepOptions,
  runStepOptions,
  stepConfigurations,
}: {
  startStepMs: number
  createStepOptions: CreateStepOptions<TaskQueue, StepConfigurations, NormalizedStepConfigurations>
  runStepOptions: RunStepOptions<TaskQueue>
  stepConfigurations: NormalizedStepConfigurations
}): Promise<StepResultOfArtifacts> {
  try {
    const userRunStepOptions: UserRunStepOptions<TaskQueue, NormalizedStepConfigurations> = {
      ...runStepOptions,
      log: runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName),
      stepConfigurations,
      startStepMs,
    }
    const userStepResult = await getUserStepResult({
      createStepOptions,
      userRunStepOptions,
      startStepMs,
    })

    const { problems } = validateUserStepResult(runStepOptions, userStepResult)

    if (problems.length > 0) {
      return {
        stepExecutionStatus: ExecutionStatus.done,
        stepInfo: runStepOptions.currentStepInfo.data.stepInfo,
        stepResult: {
          errors: [],
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
              errors: [],
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
      artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
    }> = runStepOptions.artifacts.map(node => {
      const result = userStepResult.artifactsResult[node.index]
      if (result.artifactStepResult.status === Status.passed || result.artifactStepResult.status === Status.failed) {
        return {
          ...node,
          data: {
            artifact: node.data.artifact,
            artifactStepResult: {
              executionStatus: ExecutionStatus.done,
              status: result.artifactStepResult.status,
              durationMs: result.artifactStepResult.durationMs,
              errors: result.artifactStepResult.errors,
              notes: result.artifactStepResult.notes,
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
              status: result.artifactStepResult.status,
              durationMs: result.artifactStepResult.durationMs,
              errors: result.artifactStepResult.errors,
              notes: result.artifactStepResult.notes,
            },
          },
        }
      }
    })

    const areAllDone = artifactsResult.every(a => a.data.artifactStepResult.executionStatus === ExecutionStatus.done)

    if (areAllDone) {
      return {
        stepExecutionStatus: ExecutionStatus.done,
        stepInfo: runStepOptions.currentStepInfo.data.stepInfo,
        stepResult: {
          errors: userStepResult.stepResult.errors,
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - startStepMs,
          notes: userStepResult.stepResult.notes,
          status: calculateCombinedStatus(
            userStepResult.artifactsResult.map(a => {
              if (a.artifactStepResult.executionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here`)
              }
              return a.artifactStepResult.status
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
        stepExecutionStatus: ExecutionStatus.aborted,
        stepInfo: runStepOptions.currentStepInfo.data.stepInfo,
        stepResult: {
          errors: userStepResult.stepResult.errors,
          executionStatus: ExecutionStatus.aborted,
          notes: userStepResult.stepResult.notes,
          durationMs: Date.now() - startStepMs,
          status: calculateCombinedStatus(userStepResult.artifactsResult.map(a => a.artifactStepResult.status)),
        },
        artifactsResult: artifactsResult,
      }
    }
  } catch (error: unknown) {
    const result: StepResultOfArtifacts = {
      stepExecutionStatus: ExecutionStatus.done,
      stepInfo: runStepOptions.currentStepInfo.data.stepInfo,
      stepResult: {
        executionStatus: ExecutionStatus.done,
        durationMs: Date.now() - startStepMs,
        notes: [],
        status: Status.failed,
        errors: [serializeError(error)],
      },
      artifactsResult: runStepOptions.artifacts.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          artifactStepResult: {
            errors: [],
            executionStatus: ExecutionStatus.done,
            durationMs: Date.now() - startStepMs,
            notes: [],
            status: Status.failed,
          },
        },
      })),
    }
    return result
  }
}

export function createStep<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptions<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): Step<TaskQueue> => ({
    stepName: createStepOptions.stepName,
    taskQueueClass: createStepOptions.taskQueueClass,
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
          | AbortResult<Status.skippedAsPassed | Status.skippedAsFailed | Status.failed>
          | RunningResult
          | ScheduledResult
      }> = result.artifactsResult

      await Promise.all(
        artifactsResult.map(a =>
          a.data.artifactStepResult.executionStatus === ExecutionStatus.done ||
          a.data.artifactStepResult.executionStatus === ExecutionStatus.aborted
            ? runStepOptions.immutableCache.step.setArtifactStepResult({
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
