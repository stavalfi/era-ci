import { logger } from '@tahini/log'
import { StepStatus } from '../types'
import { calculateCombinedStatus } from '../utils'
import { CacheTtl } from '../cache'
import {
  CanRunStepOnArtifactResult,
  CreateStep,
  CreateStepOptions,
  RunStepOnArtifact,
  RunStepOptions,
  StepResultOfAllPackages,
  UserArtifactResult,
  UserRunStepOptions,
  UserStepResult,
} from '../types'
import { checkIfCanRunStepOnArtifact } from './can-run-step'
import { validateUserStepResult } from './validations'

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

async function runStepOnEveryArtifact({
  startMs,
  runStepOnArtifact,
  runStepOptions,
  canRunStepResultOnArtifacts,
}: {
  startMs: number
  runStepOnArtifact: RunStepOnArtifact
  runStepOptions: RunStepOptions
  canRunStepResultOnArtifacts: CanRunStepOnArtifactResult[]
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

async function runStep({
  startMs,
  createStepOptions,
  runStepOptions,
}: {
  startMs: number
  createStepOptions: CreateStepOptions
  runStepOptions: RunStepOptions
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
        }),
      ),
    )
    let userStepResult: UserStepResult
    if ('runStepOnAllArtifacts' in createStepOptions) {
      userStepResult = await createStepOptions.runStepOnAllArtifacts({
        ...runStepOptions,
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
    } else {
      userStepResult = await runStepOnEveryArtifact({
        canRunStepResultOnArtifacts,
        runStepOptions,
        startMs,
        runStepOnArtifact: createStepOptions.runStepOnArtifact,
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

export const createStep: CreateStep = createStepOptions => async runStepOptions => {
  const startMs = Date.now()
  const result = await runStep({ startMs, createStepOptions, runStepOptions })

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
