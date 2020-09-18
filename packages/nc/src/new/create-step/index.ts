import { logger } from '@tahini/log'
import { CacheTtl } from '../cache'
import {
  CanRunStepOnArtifactResult,
  CreateStepOptions,
  RunStep,
  RunStepOnArtifact,
  RunStepOnRoot,
  RunStepOptions,
  StepResultOfAllPackages,
  StepStatus,
  UserArtifactResult,
  UserRunStepCache,
  UserStepResult,
} from '../types'
import { calculateCombinedStatus } from '../utils'
import { checkIfCanRunStepOnArtifact } from './can-run-step'
import { validateUserStepResult } from './validations'

function createStepCache(runStepOptions: RunStepOptions): UserRunStepCache {
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

async function runStepOnEveryArtifact<StepConfigurations>({
  startMs,
  runStepOnArtifact,
  runStepOptions,
  canRunStepResultOnArtifacts,
  stepConfigurations,
}: {
  startMs: number
  runStepOnArtifact: RunStepOnArtifact<StepConfigurations>
  runStepOptions: RunStepOptions
  canRunStepResultOnArtifacts: CanRunStepOnArtifactResult[]
  stepConfigurations: StepConfigurations
}): Promise<UserStepResult> {
  const artifactsResult: UserArtifactResult[] = []
  for (const [i, artifact] of runStepOptions.allArtifacts.entries()) {
    const canRunResult = canRunStepResultOnArtifacts[i]
    if (canRunResult.canRun) {
      try {
        const stepResult = await runStepOnArtifact({
          allArtifacts: runStepOptions.allArtifacts,
          cache: createStepCache(runStepOptions),
          currentArtifactIndex: i,
          log: logger(runStepOptions.stepName),
          repoPath: runStepOptions.repoPath,
          stepName: runStepOptions.stepName,
          stepConfigurations,
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
    cache: createStepCache(runStepOptions),
    log: logger(runStepOptions.stepName),
    repoPath: runStepOptions.repoPath,
    stepName: runStepOptions.stepName,
    stepConfigurations,
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
        }),
      ),
    )
    let userStepResult: UserStepResult
    if ('runStepOnAllArtifacts' in createStepOptions) {
      userStepResult = await createStepOptions.runStepOnAllArtifacts({
        ...runStepOptions,
        stepConfigurations,
        log: logger(runStepOptions.stepName),
        cache: createStepCache(runStepOptions),
        allArtifacts: runStepOptions.allArtifacts.map((node, i) => ({
          ...node,
          data: {
            ...node.data,
            ...canRunStepResultOnArtifacts[i],
          },
        })),
      })
    } else if ('runStepOnArtifact' in createStepOptions) {
      userStepResult = await runStepOnEveryArtifact({
        canRunStepResultOnArtifacts,
        runStepOptions,
        startMs,
        runStepOnArtifact: createStepOptions.runStepOnArtifact,
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
): (stepConfigurations: StepConfigurations) => RunStep {
  return stepConfigurations => async runStepOptions => {
    const startMs = Date.now()
    // @ts-ignore
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
          ttlMs: CacheTtl.stepResult,
        }),
      ),
    )

    return result
  }
}
