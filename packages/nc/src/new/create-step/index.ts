import { logger } from '@tahini/log'
import {
  CanRunStepOnArtifactResult,
  CreateStepOptions,
  RunStepOnArtifact,
  RunStepOnRoot,
  RunStepOptions,
  Step,
  StepResultOfAllPackages,
  UserArtifactResult,
  UserRunStepOptions,
  UserStepResult,
} from '../types'
import { calculateCombinedStatus } from '../utils'
import { checkIfCanRunStepOnArtifact } from './can-run-step'
import { StepExecutionStatus, StepStatus } from './types'
import { validateUserStepResult } from './validations'

export { StepStatus, StepExecutionStatus }

async function runStepOnEveryArtifact<StepConfigurations>({
  startMs,
  beforeAll,
  runStepOnArtifact,
  afterAll,
  runStepOptions,
  canRunStepResultOnArtifacts,
  stepConfigurations,
}: {
  startMs: number
  beforeAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
  runStepOnArtifact: RunStepOnArtifact<StepConfigurations>
  afterAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
  runStepOptions: RunStepOptions
  canRunStepResultOnArtifacts: CanRunStepOnArtifactResult[]
  stepConfigurations: StepConfigurations
}): Promise<UserStepResult> {
  if (beforeAll) {
    await beforeAll({
      allArtifacts: runStepOptions.allArtifacts,
      cache: runStepOptions.cache,
      log: logger(runStepOptions.stepName),
      repoPath: runStepOptions.repoPath,
      stepName: runStepOptions.stepName,
      stepConfigurations,
      flowId: runStepOptions.flowId,
      startFlowMs: runStepOptions.startFlowMs,
      stepId: runStepOptions.stepId,
      steps: runStepOptions.allSteps,
    })
  }
  const artifactsResult: UserArtifactResult[] = []
  for (const [i, artifact] of runStepOptions.allArtifacts.entries()) {
    const canRunResult = canRunStepResultOnArtifacts[i]
    if (canRunResult.canRun) {
      try {
        const stepResult = await runStepOnArtifact({
          allArtifacts: runStepOptions.allArtifacts,
          cache: runStepOptions.cache,
          currentArtifact: runStepOptions.allArtifacts[i],
          log: logger(runStepOptions.stepName),
          repoPath: runStepOptions.repoPath,
          stepName: runStepOptions.stepName,
          stepConfigurations,
          flowId: runStepOptions.flowId,
          startFlowMs: runStepOptions.startFlowMs,
          stepId: runStepOptions.stepId,
          steps: runStepOptions.allSteps,
        })
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name!,
          stepResult: {
            status: stepResult.status,
            notes: [],
            durationMs: Date.now() - startMs,
            error: stepResult.error,
          },
        })
      } catch (error) {
        artifactsResult.push({
          artifactName: artifact.data.artifact.packageJson.name!,
          stepResult: {
            status: StepStatus.failed,
            notes: [],
            durationMs: Date.now() - startMs,
            error,
          },
        })
      }
    } else {
      artifactsResult.push({
        artifactName: artifact.data.artifact.packageJson.name!,
        stepResult: {
          status: canRunResult.stepStatus,
          notes: [],
          durationMs: Date.now() - startMs,
        },
      })
    }
  }

  if (afterAll) {
    await afterAll({
      allArtifacts: runStepOptions.allArtifacts,
      cache: runStepOptions.cache,
      log: logger(runStepOptions.stepName),
      repoPath: runStepOptions.repoPath,
      stepName: runStepOptions.stepName,
      stepConfigurations,
      flowId: runStepOptions.flowId,
      startFlowMs: runStepOptions.startFlowMs,
      stepId: runStepOptions.stepId,
      steps: runStepOptions.allSteps,
    })
  }

  return {
    stepSummary: {
      notes: [],
    },
    artifactsResult,
  }
}

async function runStepOnRoot<StepConfigurations>({
  startMs,
  runStepOnRoot,
  runStepOptions,
  stepConfigurations,
}: {
  startMs: number
  runStepOnRoot: RunStepOnRoot<StepConfigurations>
  runStepOptions: RunStepOptions
  stepConfigurations: StepConfigurations
}): Promise<UserStepResult> {
  const result = await runStepOnRoot({
    allArtifacts: runStepOptions.allArtifacts,
    cache: runStepOptions.cache,
    log: logger(runStepOptions.stepName),
    repoPath: runStepOptions.repoPath,
    stepName: runStepOptions.stepName,
    stepConfigurations,
    flowId: runStepOptions.flowId,
    startFlowMs: runStepOptions.startFlowMs,
    stepId: runStepOptions.stepId,
    steps: runStepOptions.allSteps,
  })

  return {
    stepSummary: {
      notes: result.notes || [],
      error: result.error,
    },
    artifactsResult: runStepOptions.allArtifacts.map(node => ({
      artifactName: node.data.artifact.packageJson.name!,
      stepResult: {
        status: result.status,
        notes: [],
        durationMs: Date.now() - startMs,
      },
    })),
  }
}

async function runStep<StepConfigurations, NormalizedStepConfigurations>({
  startMs,
  createStepOptions,
  runStepOptions,
  stepConfigurations,
}: {
  startMs: number
  createStepOptions: CreateStepOptions<StepConfigurations, NormalizedStepConfigurations>
  runStepOptions: RunStepOptions
  stepConfigurations: NormalizedStepConfigurations
}): Promise<StepResultOfAllPackages> {
  try {
    const log = logger(runStepOptions.stepName)
    const canRunStepResultOnArtifacts = await Promise.all(
      runStepOptions.allArtifacts.map(node =>
        checkIfCanRunStepOnArtifact({
          allArtifacts: runStepOptions.allArtifacts,
          allSteps: runStepOptions.allSteps,
          cache: runStepOptions.cache,
          canRunStepOnArtifact: createStepOptions.canRunStepOnArtifact,
          rootPackage: runStepOptions.rootPackage,
          currentArtifactIndex: node.index,
          currentStepIndex: runStepOptions.currentStepIndex,
          stepConfigurations,
          log,
          repoPath: runStepOptions.repoPath,
        }),
      ),
    )
    let userStepResult: UserStepResult
    if ('runStepOnAllArtifacts' in createStepOptions) {
      userStepResult = await createStepOptions.runStepOnAllArtifacts({
        ...runStepOptions,
        stepConfigurations,
        log,
        cache: runStepOptions.cache,
        allArtifacts: runStepOptions.allArtifacts.map((node, i) => ({
          ...node,
          data: {
            ...node.data,
            ...canRunStepResultOnArtifacts[i],
          },
        })),
        flowId: runStepOptions.flowId,
        startFlowMs: runStepOptions.startFlowMs,
        stepId: runStepOptions.stepId,
        steps: runStepOptions.allSteps,
      })
    } else if ('runStepOnArtifact' in createStepOptions) {
      userStepResult = await runStepOnEveryArtifact({
        canRunStepResultOnArtifacts,
        runStepOptions,
        startMs,
        beforeAll: createStepOptions.beforeAll,
        runStepOnArtifact: createStepOptions.runStepOnArtifact,
        afterAll: createStepOptions.afterAll,
        stepConfigurations,
      })
    } else {
      userStepResult = await runStepOnRoot({
        runStepOptions,
        startMs,
        runStepOnRoot: createStepOptions.runStepOnRoot,
        stepConfigurations,
      })
    }

    const { problems } = validateUserStepResult(runStepOptions, userStepResult)

    const endDurationMs = Date.now() - startMs
    const result: StepResultOfAllPackages = {
      stepSummary: {
        stepId: runStepOptions.stepId,
        stepName: runStepOptions.stepName,
        durationMs: endDurationMs,
        notes: [...problems, ...userStepResult.stepSummary.notes],
        status:
          problems.length > 0
            ? StepStatus.failed
            : calculateCombinedStatus(userStepResult.artifactsResult.map(n => n.stepResult.status)),
      },
      artifactsResult: runStepOptions.allArtifacts.map((node, i) => {
        const result = userStepResult.artifactsResult.find(n => n.artifactName === node.data.artifact.packageJson.name)
        if (result) {
          return {
            ...node,
            data: {
              ...node.data,
              stepResult: {
                ...result.stepResult,
                stepId: runStepOptions.stepId,
                stepName: runStepOptions.stepName,
                notes: Array.from(new Set([...result.stepResult.notes, ...canRunStepResultOnArtifacts[i].notes])),
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
                notes: Array.from(
                  new Set([
                    'could not determine what is the result-status of this package',
                    ...canRunStepResultOnArtifacts[i].notes,
                  ]),
                ),
                status: StepStatus.failed,
                stepId: runStepOptions.stepId,
                stepName: runStepOptions.stepName,
              },
            },
          }
        }
      }),
    }

    return result
  } catch (error) {
    const endDurationMs = Date.now() - startMs
    const result: StepResultOfAllPackages = {
      stepSummary: {
        stepId: runStepOptions.stepId,
        stepName: runStepOptions.stepName,
        durationMs: endDurationMs,
        notes: ['step threw an error'],
        status: StepStatus.failed,
        error,
      },
      artifactsResult: runStepOptions.allArtifacts.map(node => ({
        ...node,
        data: {
          ...node.data,
          stepResult: {
            durationMs: endDurationMs,
            notes: [],
            status: StepStatus.failed,
            stepId: runStepOptions.stepId,
            stepName: runStepOptions.stepName,
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
      const startMs = Date.now()
      // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
      const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
        ? await createStepOptions.normalizeStepConfigurations(stepConfigurations)
        : stepConfigurations
      const result = await runStep({
        startMs,
        createStepOptions,
        runStepOptions,
        stepConfigurations: normalizedStepConfigurations,
      })

      await Promise.all(
        result.artifactsResult.map(artifact =>
          runStepOptions.cache.step.setStepResult({
            packageHash: artifact.data.artifact.packageHash,
            stepId: result.stepSummary.stepId,
            stepStatus: artifact.data.stepResult.status,
            ttlMs: runStepOptions.cache.ttls.stepResult,
          }),
        ),
      )

      return result
    },
  })
}
