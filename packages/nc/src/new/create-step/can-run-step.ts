import _ from 'lodash'
import { Cache } from '../create-cache'
import { Log } from '../create-logger'
import {
  Artifact,
  CanRunStepOnArtifact,
  CanRunStepOnArtifactResult,
  RootPackage,
  StepNodeData,
  StepResultOfAllPackages,
  Graph,
} from '../types'
import { didPassOrSkippedAsPassed } from '../utils'
import { StepExecutionStatus, StepStatus } from './types'

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

async function skipIfPackageResultsInCachePredicate<StepConfigurations>({
  canRunStepOnArtifact,
  cache,
  allArtifacts,
  currentArtifactIndex,
  allSteps,
  currentStepIndex,
}: {
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
  allArtifacts: Graph<{ artifact: Artifact }>
  currentArtifactIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<StepNodeData<StepResultOfAllPackages>>
}): Promise<CanRunStepOnArtifactResult> {
  const result = await cache.step.getStepResult({
    stepId: allSteps[currentStepIndex].data.stepInfo.stepId,
    packageHash: allArtifacts[currentArtifactIndex].data.artifact.packageHash,
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

async function skipIfSomeDirectPrevStepsFailedOnPackage<StepConfigurations>({
  allSteps,
  currentStepIndex,
  canRunStepOnArtifact,
  currentArtifactIndex,
}: {
  currentStepIndex: number
  allSteps: Graph<StepNodeData<StepResultOfAllPackages>>
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
  currentArtifactIndex: number
}): Promise<CanRunStepOnArtifactResult> {
  const notes: string[] = []
  const didAllPrevPassed = await allSteps[currentStepIndex].parentsIndexes
    .map((_result, i) => allSteps[i].data)
    .every(
      step =>
        step.stepExecutionStatus === StepExecutionStatus.done &&
        [StepStatus.passed, StepStatus.skippedAsPassed].includes(
          step.stepResult.artifactsResult[currentArtifactIndex].data.stepResult.status,
        ),
    )
  if (didAllPrevPassed) {
    notes.push(`skipping step because not all previous steps passed`)
  }
  if (didAllPrevPassed) {
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

export async function checkIfCanRunStepOnArtifact<StepConfigurations>(options: {
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
  allArtifacts: Graph<{ artifact: Artifact }>
  currentArtifactIndex: number
  cache: Cache
  currentStepIndex: number
  allSteps: Graph<StepNodeData<StepResultOfAllPackages>>
  rootPackage: RootPackage
  stepConfigurations: StepConfigurations
  log: Log
  repoPath: string
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
              stepConfigurations: options.stepConfigurations,
              log: options.log,
              repoPath: options.repoPath,
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
