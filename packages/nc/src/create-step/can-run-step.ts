import _ from 'lodash'
import { Artifact, Node } from '../types'
import { calculateCombinedStatus, didPassOrSkippedAsPassed } from '../utils'
import { CanRunStepOnArtifact, CanRunStepOnArtifactResult, ExecutionStatus, Status, UserRunStepOptions } from './types'

const runAll = async (
  array: { checkName: string; predicate: () => Promise<CanRunStepOnArtifactResult> }[],
): Promise<CanRunStepOnArtifactResult> => {
  const results = await Promise.all(array.map(x => x.predicate()))
  const canRun = results.every(x => x.canRun)
  const notes = _.uniq(
    _.flatMapDeep(
      results.map((x, i) =>
        x.artifactStepResult.notes.map(note =>
          array[i].checkName === 'custom-step-predicate' ? note : `${array[i].checkName} - ${note}`,
        ),
      ),
    ),
  )
  if (canRun) {
    return {
      canRun: true,
      artifactStepResult: {
        notes,
      },
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatten(results.map(r => (r.canRun ? [] : [r.artifactStepResult.status]))),
    )
    return {
      canRun: false,
      artifactStepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
      },
    }
  }
}

async function runIfPackageResultsInCache<StepConfigurations>({
  canRunStepOnArtifact,
  cache,
  currentArtifact,
  currentStepInfo,
}: UserRunStepOptions<StepConfigurations> & {
  currentArtifact: Node<{ artifact: Artifact }>
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
}): Promise<CanRunStepOnArtifactResult> {
  const result = await cache.step.getArtifactStepResult({
    stepId: currentStepInfo.data.stepInfo.stepId,
    artifactHash: currentArtifact.data.artifact.packageHash,
  })

  if (!result) {
    return {
      canRun: true,
      artifactStepResult: {
        notes: [],
      },
    }
  }

  if (
    result.artifactStepResult.executionStatus !== ExecutionStatus.aborted &&
    result.artifactStepResult.executionStatus !== ExecutionStatus.done
  ) {
    return {
      canRun: true,
      artifactStepResult: {
        notes: [],
      },
    }
  }

  const isPassed = didPassOrSkippedAsPassed(result.artifactStepResult.status)

  if (canRunStepOnArtifact?.options?.runIfPackageResultsInCache) {
    return {
      canRun: true,
      artifactStepResult: {
        notes: [
          `rerun step but step already run on this package with the same hash in flow-id: "${
            result.flowId
          }". result: "${isPassed ? 'passed' : 'failed'}"`,
        ],
      },
    }
  } else {
    return {
      canRun: false,
      artifactStepResult: {
        notes: [
          `step already run on this package with the same hash in flow-id: "${result.flowId}". result: "${
            isPassed ? 'passed' : 'failed'
          }"`,
        ],
        executionStatus: ExecutionStatus.aborted,
        status: isPassed ? Status.skippedAsPassed : Status.skippedAsFailed,
      },
    }
  }
}

async function runIfSomeDirectParentStepFailedOnPackage<StepConfigurations>({
  stepsResultOfArtifactsByStep,
  currentStepInfo,
  canRunStepOnArtifact,
  currentArtifact,
}: UserRunStepOptions<StepConfigurations> & {
  currentArtifact: Node<{ artifact: Artifact }>
  canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
}): Promise<CanRunStepOnArtifactResult> {
  const didAllPrevPassed = await currentStepInfo.parentsIndexes
    .map(
      (_result, i) =>
        stepsResultOfArtifactsByStep[i].data.artifactsResult[currentArtifact.index].data.artifactStepResult,
    )
    .every(
      artifactStepResult =>
        (artifactStepResult.executionStatus === ExecutionStatus.done ||
          artifactStepResult.executionStatus === ExecutionStatus.aborted) &&
        didPassOrSkippedAsPassed(artifactStepResult.status),
    )

  if (didAllPrevPassed || canRunStepOnArtifact?.options?.runIfSomeDirectParentStepFailedOnPackage) {
    return {
      canRun: true,
      artifactStepResult: {
        notes: [],
      },
    }
  } else {
    return {
      canRun: false,
      artifactStepResult: {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsFailed,
        notes: [`skipping step because not all previous steps passed`],
      },
    }
  }
}

export async function checkIfCanRunStepOnArtifact<StepConfigurations>(
  options: UserRunStepOptions<StepConfigurations> & {
    currentArtifact: Node<{ artifact: Artifact }>
    canRunStepOnArtifact?: CanRunStepOnArtifact<StepConfigurations>
  },
): Promise<CanRunStepOnArtifactResult> {
  return runAll([
    {
      checkName: 'custom-step-predicate',
      predicate: async () => {
        if (options.canRunStepOnArtifact?.customPredicate) {
          const result = await options.canRunStepOnArtifact.customPredicate(_.omit(options, ['canRunStepOnArtifact']))
          if (result === true) {
            return { canRun: true, artifactStepResult: { notes: [] } }
          } else {
            return result
          }
        } else {
          return {
            canRun: true,
            artifactStepResult: {
              notes: [],
            },
          }
        }
      },
    },
    {
      checkName: 'skip-if-package-results-in-cache',
      predicate: () => runIfPackageResultsInCache(options),
    },
    {
      checkName: 'skip-if-some-direct-prev-steps-failed-on-package',
      predicate: () => runIfSomeDirectParentStepFailedOnPackage(options),
    },
  ])
}
