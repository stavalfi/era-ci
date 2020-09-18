import _ from 'lodash'
import { Artifact, Graph } from '../../types'
import { CacheTtl } from '../cache'
import {
  Cache,
  CanRunStepOnArtifact,
  CanRunStepOnArtifactResult,
  RootPackage,
  StepInfo,
  StepResultOfPackage,
  StepStatus,
} from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

const runAll = async (
  array: { checkName: string; predicate: () => Promise<CanRunStepOnArtifactResult> }[],
): Promise<CanRunStepOnArtifactResult> => {
  if (array.length === 0) {
    throw new Error(`nothing to run. possible bug?`)
  }
  const results = await Promise.all(array.map(x => x.predicate()))
  const canRun = results.every(x => x.canRun)
  const notes = _.flatMap(
    results.map(x => x.notes),
    x => x,
  )
  if (canRun) {
    return {
      canRun: true,
      notes,
    }
  } else {
    return {
      canRun: false,
      notes,
      stepStatus: results.reduce((acc: StepStatus, x) => {
        if (x.canRun) {
          return acc
        } else {
          if (acc === StepStatus.failed) {
            return acc
          }
          if (x.stepStatus === StepStatus.failed) {
            return x.stepStatus
          }
          if (acc === StepStatus.skippedAsFailed) {
            return acc
          }
          if (x.stepStatus === StepStatus.skippedAsFailed) {
            return x.stepStatus
          }
          return StepStatus.skippedAsPassed
        }
      }, StepStatus.skippedAsPassed),
    }
  }
}

async function skipIfPackageResultsInCachePredicate({
  canRunStepOnArtifact,
  cache,
  allArtifacts,
  currentArtifactIndex,
  allSteps,
  currentStepIndex,
}: {
  canRunStepOnArtifact?: CanRunStepOnArtifact
  allArtifacts: Graph<{ artifact: Artifact }>
  currentArtifactIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
}): Promise<CanRunStepOnArtifactResult> {
  const result = await cache.step.getStepResult({
    stepId: allSteps[currentStepIndex].data.stepInfo.stepId,
    packageHash: allArtifacts[currentArtifactIndex].data.artifact.packageHash,
    ttlMs: CacheTtl.stepResult,
  })
  if (result?.didStepRun) {
    const isPassed = didPassOrSkippedAsPassed(result.StepStatus)
    const note = `step already run on this package with the same hash in flow-id: "${result.flowId}". result: "${
      isPassed ? 'passed' : 'failed'
    }"`
    if (canRunStepOnArtifact?.options?.skipIfPackageResultsInCache) {
      return {
        canRun: false,
        notes: [note],
        stepStatus: isPassed ? StepStatus.skippedAsPassed : StepStatus.skippedAsFailed,
      }
    } else {
      return {
        canRun: true,
        notes: [`rerun step but ${note}`],
      }
    }
  } else {
    return {
      canRun: true,
      notes: [],
    }
  }
}

async function skipIfSomeDirectPrevStepsFailedOnPackage({
  allSteps,
  currentStepIndex,
  canRunStepOnArtifact,
}: {
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
  canRunStepOnArtifact?: CanRunStepOnArtifact
}): Promise<CanRunStepOnArtifactResult> {
  const notes: string[] = []
  const didAllPreviousPassed = await allSteps[currentStepIndex].parentsIndexes
    .map(i => allSteps[i].data.stepResult!)
    .every(result => [StepStatus.passed, StepStatus.skippedAsPassed].includes(result.status))
  if (didAllPreviousPassed) {
    notes.push(`skipping step because not all previous steps passed`)
  }
  if (didAllPreviousPassed) {
    return {
      canRun: true,
      notes,
    }
  } else {
    if (canRunStepOnArtifact?.options?.skipIfSomeDirectPrevStepsFailedOnPackage) {
      return {
        canRun: false,
        notes,
        stepStatus: StepStatus.skippedAsFailed,
      }
    } else {
      return {
        canRun: true,
        notes,
      }
    }
  }
}

export async function checkIfCanRunStepOnArtifact(options: {
  canRunStepOnArtifact?: CanRunStepOnArtifact
  allArtifacts: Graph<{ artifact: Artifact }>
  currentArtifactIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
  rootPackage: RootPackage
}): Promise<CanRunStepOnArtifactResult> {
  return runAll([
    {
      checkName: 'custom-step-predicate',
      predicate: async () =>
        options.canRunStepOnArtifact?.customPredicate
          ? options.canRunStepOnArtifact.customPredicate({
              cache: options.cache,
              allArtifacts: options.allArtifacts,
              allSteps: options.allSteps,
              currentStepInfo: options.allSteps[options.currentStepIndex],
              currentArtifact: options.allArtifacts[options.currentArtifactIndex],
              rootPackage: options.rootPackage,
            })
          : { canRun: true, notes: [] },
    },
    {
      checkName: 'skip-if-package-results-in-cache',
      predicate: () => skipIfPackageResultsInCachePredicate(options),
    },
    {
      checkName: 'skip-if-some-direct-prev-steps-failed-on-package',
      predicate: () => skipIfSomeDirectPrevStepsFailedOnPackage(options),
    },
  ])
}
